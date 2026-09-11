import {
  Project,
  SubmissionBatch,
  SubmissionBatchItem,
  Url,
  type SubmissionBatchItemDocument,
} from '@indexrocket/database';
import {
  GoogleConnectionError,
  inspectUrlWithGoogle,
  listProperties,
  resolveAccessToken,
  urlBelongsToProperty,
} from '@indexrocket/google';
import type { SubmissionJobData, SubmissionJobResult } from '@indexrocket/types';
import { redactUrlForLog } from '@indexrocket/utils';
import { UnrecoverableError, type Job } from 'bullmq';
import { Types } from 'mongoose';

import { env } from '../config/env.js';
import { runDiscovery } from '../services/discoveryRunner.js';
import { runInspection } from '../services/inspectionRunner.js';
import { finaliseBatchIfDone } from '../services/batchProgress.js';

/**
 * Inspection is skipped when the URL was already inspected recently, so a batch
 * that overlaps a previous one does not re-fetch every page.
 */
const INSPECTION_FRESHNESS_MS = 60 * 60 * 1000;

interface StageState {
  inspection: SubmissionBatchItemDocument['inspectionStatus'];
  discovery: SubmissionBatchItemDocument['discoveryStatus'];
  google: SubmissionBatchItemDocument['googleStatus'];
  notes: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

async function completeItem(
  itemId: string,
  status: 'completed' | 'failed' | 'skipped',
  state: StageState,
): Promise<void> {
  // Only a claimed (processing) item is finalised, so a duplicate job that lost
  // the claim race cannot double-count the batch counters.
  const updated = await SubmissionBatchItem.findOneAndUpdate(
    { _id: itemId, status: 'processing' },
    {
      $set: {
        status,
        inspectionStatus: state.inspection,
        discoveryStatus: state.discovery,
        googleStatus: state.google,
        notes: state.notes,
        errorCode: state.errorCode,
        errorMessage: state.errorMessage,
        completedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  if (updated === null) {
    return;
  }

  const counter = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'skipped';

  await SubmissionBatch.updateOne(
    { _id: updated.batchId },
    { $inc: { processing: -1, [counter]: 1 } },
  );

  await finaliseBatchIfDone(updated.batchId.toString());
}

/**
 * Processes one URL of one batch.
 *
 * Ordering is inspection -> IndexNow -> Google, because discovery eligibility
 * depends on a fresh inspection result and Google inspection is only meaningful
 * for a URL we have already looked at. Each stage records its own outcome; the
 * three are never collapsed into one status.
 */
export async function submissionProcessor(
  job: Job<SubmissionJobData, SubmissionJobResult>,
): Promise<SubmissionJobResult> {
  const { batchId, itemId, projectId, userId, urlId, url, inspectGoogle, googleSiteUrl } = job.data;

  if (!Types.ObjectId.isValid(itemId) || !Types.ObjectId.isValid(batchId)) {
    throw new UnrecoverableError('Submission payload is malformed.');
  }

  const batch = await SubmissionBatch.findById(batchId);

  if (batch === null) {
    throw new UnrecoverableError(`Batch ${batchId} no longer exists.`);
  }

  // Cancellation is honoured at claim time: pending work never starts.
  if (batch.status === 'cancelled') {
    await SubmissionBatchItem.updateOne(
      { _id: itemId, status: { $in: ['pending', 'processing'] } },
      { $set: { status: 'skipped', errorCode: 'cancelled', errorMessage: 'Batch was cancelled.', completedAt: new Date() } },
    );

    return { itemId, status: 'skipped', inspection: 'not_run', discovery: 'not_run', google: 'not_run' };
  }

  // Atomic claim. A duplicate job, a replay, or a second worker finds the item
  // already claimed and exits without repeating any provider call.
  const claimed = await SubmissionBatchItem.findOneAndUpdate(
    { _id: itemId, status: 'pending' },
    { $set: { status: 'processing', startedAt: new Date() }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );

  if (claimed === null) {
    const existing = await SubmissionBatchItem.findById(itemId);

    // A retry of a genuinely interrupted item is allowed to resume; anything
    // already finished is left exactly as it is.
    if (existing === null || existing.status !== 'processing') {
      return {
        itemId,
        status: 'skipped',
        inspection: existing?.inspectionStatus ?? 'not_run',
        discovery: existing?.discoveryStatus ?? 'not_run',
        google: existing?.googleStatus ?? 'not_run',
      };
    }

    await SubmissionBatchItem.updateOne({ _id: itemId }, { $inc: { attempts: 1 } });
  }

  await SubmissionBatch.updateOne(
    { _id: batchId, startedAt: null },
    { $set: { startedAt: new Date(), status: 'processing' } },
  );
  await SubmissionBatch.updateOne(
    { _id: batchId, status: 'pending' },
    { $set: { status: 'processing' } },
  );
  // Only a fresh claim moves the cached counters; a resumed retry already did.
  if (claimed !== null) {
    await SubmissionBatch.updateOne({ _id: batchId }, { $inc: { pending: -1, processing: 1 } });
  }

  const state: StageState = {
    inspection: 'not_run',
    discovery: 'not_run',
    google: 'not_run',
    notes: [],
    errorCode: null,
    errorMessage: null,
  };

  console.log(`Batch ${batchId} item ${itemId}: ${redactUrlForLog(url)}`);

  // Ownership is re-verified here, not assumed from the payload.
  const project = await Project.findOne({
    _id: projectId,
    userId: new Types.ObjectId(userId),
  }).select('+indexNowKey');

  if (project === null) {
    state.errorCode = 'project_missing';
    state.errorMessage = 'The project no longer exists or is not owned by this user.';
    await completeItem(itemId, 'failed', state);
    throw new UnrecoverableError(state.errorMessage);
  }

  let document = await Url.findOne({ _id: urlId, projectId: project._id });

  if (document === null) {
    state.errorCode = 'url_missing';
    state.errorMessage = 'The URL no longer belongs to this project.';
    await completeItem(itemId, 'failed', state);
    throw new UnrecoverableError(state.errorMessage);
  }

  // --- stage 1: inspection --------------------------------------------------
  const lastInspected = document.lastInspectedAt?.getTime() ?? 0;
  const fresh = document.status === 'inspected' && Date.now() - lastInspected < INSPECTION_FRESHNESS_MS;

  if (fresh) {
    state.inspection = 'skipped';
    state.notes.push('Inspection skipped: a recent result was reused.');
  } else {
    const outcome = await runInspection(urlId, url);

    if (outcome.ok) {
      state.inspection = 'succeeded';
      state.notes.push(outcome.summary.join(' · '));
      document = outcome.document ?? document;
    } else {
      state.inspection = 'failed';
      state.errorCode = outcome.permanent ? 'inspection_invalid' : 'inspection_failed';
      state.errorMessage = outcome.message;

      if (outcome.permanent) {
        // A bad URL cannot become good by retrying.
        await completeItem(itemId, 'failed', state);
        throw new UnrecoverableError(outcome.message);
      }

      // A timeout can. The item stays claimed so the retry resumes it; if every
      // attempt fails, the submission worker's failure handler marks it failed.
      await SubmissionBatchItem.updateOne(
        { _id: itemId },
        { $set: { errorCode: state.errorCode, errorMessage: state.errorMessage } },
      );
      throw new Error(outcome.message);
    }
  }

  const refreshed = await Url.findById(urlId);

  if (refreshed !== null) {
    document = refreshed;
  }

  // --- stage 2: IndexNow ----------------------------------------------------
  const discovery = await runDiscovery(project, document);

  if (discovery.result === 'notified') {
    state.discovery = 'succeeded';
    state.notes.push(`IndexNow notification accepted (HTTP ${discovery.statusCode ?? 'n/a'}).`);
  } else if (discovery.result === 'skipped') {
    state.discovery = 'skipped';
    state.notes.push(`IndexNow skipped: ${discovery.message}`);
  } else {
    state.discovery = 'failed';
    state.errorCode = discovery.code;
    state.errorMessage = discovery.message;

    if (!discovery.permanent) {
      await SubmissionBatchItem.updateOne(
        { _id: itemId },
        { $set: { status: 'processing', errorCode: discovery.code, errorMessage: discovery.message } },
      );

      throw new Error(discovery.message);
    }
  }

  // --- stage 3: Google (opt-in only) ---------------------------------------
  if (inspectGoogle && googleSiteUrl !== null && env.google !== null) {
    try {
      const token = await resolveAccessToken(userId, {
        config: env.google,
        encryptionKey: env.encryptionKey,
      });

      // The property must still be one this Google account holds.
      const properties = await listProperties(token);
      const property = properties.find((entry) => entry.siteUrl === googleSiteUrl);

      if (property === undefined) {
        state.google = 'failed';
        state.notes.push('Google skipped: the account no longer has access to that property.');
      } else if (!urlBelongsToProperty(document.url, property.siteUrl)) {
        state.google = 'failed';
        state.notes.push('Google skipped: the URL does not belong to the selected property.');
      } else {
        const snapshot = await inspectUrlWithGoogle(token, document.url, property.siteUrl);

        await Url.updateOne(
          { _id: urlId },
          { $set: { googleInspection: { ...snapshot, inspectedAt: new Date(snapshot.inspectedAt) } } },
        );

        state.google = 'succeeded';
        state.notes.push(`Google reported: ${snapshot.verdict ?? 'no verdict'} (${snapshot.status}).`);
      }
    } catch (error) {
      const permanent = error instanceof GoogleConnectionError && !error.recoverable;
      const message = error instanceof Error ? error.message : 'Google inspection failed.';

      state.google = 'failed';
      state.notes.push(`Google inspection failed: ${message}`);

      if (!permanent) {
        state.errorCode = 'google_transient';
        state.errorMessage = message;
        throw new Error(message);
      }
    }
  } else if (inspectGoogle) {
    state.google = 'skipped';
    state.notes.push('Google skipped: no property selected or the integration is not configured.');
  }

  // Inspection failure already returned above, so only the later two stages can
  // still mark the item failed here.
  const failedStage = state.discovery === 'failed' || state.google === 'failed';

  await completeItem(itemId, failedStage ? 'failed' : 'completed', state);

  console.log(
    `Batch ${batchId} item ${itemId}: inspection=${state.inspection} discovery=${state.discovery} google=${state.google}`,
  );

  return {
    itemId,
    status: failedStage ? 'failed' : 'completed',
    inspection: state.inspection,
    discovery: state.discovery,
    google: state.google,
  };
}
