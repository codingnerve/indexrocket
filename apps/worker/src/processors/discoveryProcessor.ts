import { Project, Url } from '@indexrocket/database';
import type { DiscoveryJobData, DiscoveryJobResult } from '@indexrocket/types';
import { evaluateDiscoveryEligibility, hostOfUrl } from '@indexrocket/utils';
import { UnrecoverableError, type Job } from 'bullmq';
import { Types } from 'mongoose';

import { getDiscoveryProvider } from '../providers/registry.js';
import { PermanentProviderError } from '../providers/types.js';

function assertValidPayload(data: unknown): asserts data is DiscoveryJobData {
  if (typeof data !== 'object' || data === null) {
    throw new UnrecoverableError('Discovery payload must be an object.');
  }

  const { projectId, urlIds } = data as Record<string, unknown>;

  if (typeof projectId !== 'string' || !Types.ObjectId.isValid(projectId)) {
    throw new UnrecoverableError('Discovery payload has an invalid "projectId".');
  }

  if (!Array.isArray(urlIds) || urlIds.length === 0) {
    throw new UnrecoverableError('Discovery payload must contain at least one url id.');
  }

  if (!urlIds.every((id) => typeof id === 'string' && Types.ObjectId.isValid(id))) {
    throw new UnrecoverableError('Discovery payload contains an invalid url id.');
  }
}

async function markFailed(urlIds: string[], statusCode: number | null, error: string): Promise<void> {
  await Url.updateMany(
    { _id: { $in: urlIds } },
    {
      $set: {
        indexNowStatus: 'failed',
        indexNowResponseCode: statusCode,
        indexNowLastError: error.slice(0, 500),
      },
    },
  );
}

export async function discoveryProcessor(
  job: Job<DiscoveryJobData, DiscoveryJobResult>,
): Promise<DiscoveryJobResult> {
  const jobId = job.id ?? 'unknown';

  assertValidPayload(job.data);

  const { projectId, urlIds } = job.data;

  // The key is a secret and excluded by default, so it must be selected explicitly.
  const project = await Project.findById(projectId).select('+indexNowKey');

  if (project === null) {
    throw new UnrecoverableError(`Project ${projectId} no longer exists.`);
  }

  const key = project.indexNowKey ?? null;

  if (key === null || key.trim() === '') {
    await markFailed(urlIds, null, 'The project has no IndexNow key configured.');
    throw new UnrecoverableError('The project has no IndexNow key configured.');
  }

  const documents = await Url.find({ _id: { $in: urlIds } });

  if (documents.length === 0) {
    throw new UnrecoverableError('None of the requested URLs exist.');
  }

  // Eligibility is re-checked here: state may have changed since the job was queued.
  const eligible = documents.filter(
    (document) =>
      evaluateDiscoveryEligibility(
        {
          status: document.status,
          httpStatus: document.httpStatus ?? null,
          url: document.url,
          indexNowStatus: document.indexNowStatus ?? null,
          indexNowSubmittedAt: document.indexNowSubmittedAt ?? null,
        },
        { domain: project.domain, hasIndexNowKey: true },
      ).eligible,
  );

  if (eligible.length === 0) {
    console.log(
      [
        `Discovery job ${jobId}`,
        'Provider: IndexNow',
        'Skipped: no eligible URLs (already notified recently, or not inspected).',
      ].join('\n'),
    );

    return {
      provider: 'indexnow',
      accepted: false,
      statusCode: null,
      urlIds: [],
      submittedAt: new Date().toISOString(),
    };
  }

  // Every URL in one IndexNow request must share the same host.
  const host = hostOfUrl(eligible[0]?.url ?? '');

  if (host === null) {
    throw new UnrecoverableError('Could not determine the host for the notification.');
  }

  const sameHost = eligible.filter((document) => hostOfUrl(document.url) === host);
  const urls = sameHost.map((document) => document.url);
  const ids = sameHost.map((document) => document._id.toString());

  console.log(
    [
      `Discovery job ${jobId}`,
      'Provider: IndexNow',
      `Host: ${host}`,
      `URLs: ${urls.length}`,
    ].join('\n'),
  );

  await Url.updateMany({ _id: { $in: ids } }, { $set: { indexNowStatus: 'pending' } });

  try {
    const result = await getDiscoveryProvider('indexnow').notifyUrls({
      host,
      urls,
      key,
      keyLocation: project.indexNowKeyLocation ?? null,
    });

    await Url.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          // "accepted" records that the provider took the notification.
          // It is never evidence of crawling or indexing.
          indexNowStatus: result.accepted ? 'accepted' : 'failed',
          indexNowSubmittedAt: new Date(result.submittedAt),
          indexNowResponseCode: result.statusCode,
          indexNowLastError: result.accepted ? null : result.message,
        },
      },
    );

    console.log(
      [
        result.accepted
          ? '✓ IndexNow notification accepted'
          : '✗ IndexNow notification rejected',
        `HTTP: ${result.statusCode ?? 'n/a'}`,
      ].join('\n'),
    );

    if (!result.accepted) {
      // Retryable (e.g. 429 or an unexpected status): let BullMQ back off.
      throw new Error(`IndexNow rejected the notification: ${result.message}`);
    }

    return {
      provider: 'indexnow',
      accepted: true,
      statusCode: result.statusCode,
      urlIds: ids,
      submittedAt: result.submittedAt,
    };
  } catch (error) {
    const permanent = error instanceof PermanentProviderError;
    const message = error instanceof Error ? error.message : 'Unknown discovery failure.';
    const statusCode = permanent ? error.statusCode : null;

    await markFailed(ids, statusCode, message);

    console.error(
      ['✗ IndexNow notification rejected', `HTTP: ${statusCode ?? 'n/a'}`, `Reason: ${message}`].join('\n'),
    );

    // Permanent rejections must not be retried; everything else may be.
    throw permanent ? new UnrecoverableError(message) : error;
  }
}
