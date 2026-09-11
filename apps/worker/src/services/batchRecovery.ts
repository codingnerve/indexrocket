import { SubmissionBatch, SubmissionBatchItem, type SubmissionBatchDocument } from '@indexrocket/database';
import { addSubmissionJob, getSubmissionQueue } from '@indexrocket/queue';

import { finaliseBatchIfDone, finalizeExhaustedItem } from './batchProgress.js';

/** An item "processing" for longer than this with no live job was interrupted. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

/** Bounded so recovery can never become an unbounded startup scan. */
const MAX_RECOVERY_ITEMS = 5_000;

const LIVE_JOB_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export interface RecoveryReport {
  examined: number;
  requeued: number;
  markedFailed: number;
  skippedCancelled: number;
  alreadyQueued: number;
  batchesReconciled: number;
}

/**
 * Brings unfinished batches back to a consistent state after a crash, restart
 * or deploy. Runs once at worker startup.
 *
 * For every item still pending, or stuck processing past the stale window:
 *  - its job is still queued or running  -> leave it alone
 *  - its job failed for good              -> mark the item failed
 *  - its batch was cancelled              -> mark a pending item skipped
 *  - its job is missing (lost/removed)    -> enqueue it again
 *
 * Re-running is safe: the job id is the item id, so an item already queued is
 * not queued twice, the processor's atomic claim stops duplicate execution, and
 * the 24-hour IndexNow cooldown stops a repeated notification even if an item
 * is processed a second time.
 */
export async function recoverBatches(now: Date = new Date()): Promise<RecoveryReport> {
  const report: RecoveryReport = {
    examined: 0,
    requeued: 0,
    markedFailed: 0,
    skippedCancelled: 0,
    alreadyQueued: 0,
    batchesReconciled: 0,
  };

  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);

  const items = await SubmissionBatchItem.find({
    $or: [{ status: 'pending' }, { status: 'processing', updatedAt: { $lt: cutoff } }],
  })
    .sort({ updatedAt: 1 })
    .limit(MAX_RECOVERY_ITEMS);

  const batches = new Map<string, SubmissionBatchDocument | null>();
  const touched = new Set<string>();
  const queue = getSubmissionQueue();

  for (const item of items) {
    report.examined += 1;

    const batchId = item.batchId.toString();
    if (!batches.has(batchId)) {
      batches.set(batchId, await SubmissionBatch.findById(batchId));
    }

    const batch = batches.get(batchId) ?? null;

    if (batch === null) {
      continue;
    }

    touched.add(batchId);

    if (batch.status === 'cancelled') {
      if (item.status === 'pending') {
        await SubmissionBatchItem.updateOne(
          { _id: item._id, status: 'pending' },
          {
            $set: {
              status: 'skipped',
              errorCode: 'cancelled',
              errorMessage: 'Batch was cancelled.',
              completedAt: now,
            },
          },
        );
      }

      report.skippedCancelled += 1;
      continue;
    }

    const itemId = item._id.toString();
    const job = await queue.getJob(itemId);
    const state = job === undefined ? null : await job.getState();

    if (state !== null && LIVE_JOB_STATES.has(state)) {
      report.alreadyQueued += 1;
      continue;
    }

    if (state === 'failed') {
      await finalizeExhaustedItem(itemId, job?.failedReason ?? 'The job failed.');
      report.markedFailed += 1;
      continue;
    }

    // A completed job next to an unfinished item lost its final write; the id
    // must be released before the item can be queued again.
    if (state === 'completed' && job !== undefined) {
      await job.remove();
    }

    await addSubmissionJob({
      batchId,
      itemId,
      projectId: item.projectId.toString(),
      userId: batch.userId.toString(),
      urlId: item.urlId.toString(),
      url: item.url,
      inspectGoogle: batch.inspectGoogle,
      googleSiteUrl: batch.googleSiteUrl ?? null,
    });

    report.requeued += 1;
  }

  for (const batchId of touched) {
    await finaliseBatchIfDone(batchId);
    report.batchesReconciled += 1;
  }

  return report;
}
