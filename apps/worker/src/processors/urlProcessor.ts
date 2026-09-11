import { Url } from '@indexrocket/database';
import type { UrlInspectionJobData, UrlInspectionJobResult } from '@indexrocket/types';
import { redactUrlForLog } from '@indexrocket/utils';
import { Types } from 'mongoose';
import type { Job } from 'bullmq';

import { scheduleDiscoveryIfEligible } from '../services/discoveryScheduler.js';
import { runInspection } from '../services/inspectionRunner.js';

function assertValidPayload(data: unknown): asserts data is UrlInspectionJobData {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Job payload must be an object.');
  }

  const { urlId, projectId, url } = data as Record<string, unknown>;

  if (typeof urlId !== 'string' || !Types.ObjectId.isValid(urlId)) {
    throw new Error('Job payload has an invalid "urlId".');
  }

  if (typeof projectId !== 'string' || !Types.ObjectId.isValid(projectId)) {
    throw new Error('Job payload has an invalid "projectId".');
  }

  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('Job payload has an invalid "url".');
  }
}

export async function urlProcessor(
  job: Job<UrlInspectionJobData, UrlInspectionJobResult>,
): Promise<UrlInspectionJobResult> {
  const jobId = job.id ?? 'unknown';

  assertValidPayload(job.data);

  const { urlId, url } = job.data;

  console.log(`Processing URL job ${jobId}
URL: ${redactUrlForLog(url)}`);

  // The inspect-and-persist logic is shared with the bulk submission processor.
  const outcome = await runInspection(urlId, url);

  if (!outcome.ok) {
    console.error(`✗ URL inspection failed (job ${jobId})
Reason: ${outcome.message}`);

    throw new Error(outcome.message);
  }

  // Emitted as one write so concurrent jobs cannot interleave their summaries.
  console.log([...outcome.summary, `✓ URL inspection completed (job ${jobId})`].join('\n'));

  // Discovery is a separate job on a separate queue; it never blocks inspection.
  if (outcome.document !== null) {
    await scheduleDiscoveryIfEligible(outcome.document);
  }

  const document = outcome.document ?? (await Url.findById(urlId));

  return {
    success: true,
    urlId,
    url,
    httpStatus: document?.httpStatus ?? null,
    inspectedAt: new Date().toISOString(),
  };
}
