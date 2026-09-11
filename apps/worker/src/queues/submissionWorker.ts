import { getRedisConnection, SUBMISSION_QUEUE_NAME } from '@indexrocket/queue';
import type { SubmissionJobData, SubmissionJobResult } from '@indexrocket/types';
import { Worker } from 'bullmq';

import { env } from '../config/env.js';
import { submissionProcessor } from '../processors/submissionProcessor.js';
import { finalizeExhaustedItem } from '../services/batchProgress.js';

export function createSubmissionWorker(): Worker<SubmissionJobData, SubmissionJobResult> {
  const worker = new Worker<SubmissionJobData, SubmissionJobResult>(
    SUBMISSION_QUEUE_NAME,
    submissionProcessor,
    {
      connection: getRedisConnection({ url: env.redisUrl }),
      // Bounded: a batch item may notify IndexNow and call Google, so this queue
      // inherits the same conservative posture as discovery.
      concurrency: env.submissionConcurrency,
      limiter: { max: env.discoveryRateMax, duration: env.discoveryRateDurationMS },
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`✓ Batch item completed: ${job.id ?? 'unknown'} (${result?.status ?? 'unknown'})`);
  });

  worker.on('failed', (job, error) => {
    console.error(`✗ Batch item failed: ${job?.id ?? 'unknown'} - ${error.message}`);

    if (job === undefined) {
      return;
    }

    // Final failure (retries exhausted, or declared unrecoverable): make sure the
    // item and its batch reach a terminal state instead of staying "processing".
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts || error.name === 'UnrecoverableError';

    if (exhausted) {
      void finalizeExhaustedItem(job.data.itemId, error.message).catch((finalizeError: unknown) => {
        console.error(
          `Could not finalise batch item ${job.data.itemId}: ${finalizeError instanceof Error ? finalizeError.message : 'unknown error'}`,
        );
      });
    }
  });

  worker.on('error', (error) => {
    console.error('Submission worker error:', error.message);
  });

  return worker;
}
