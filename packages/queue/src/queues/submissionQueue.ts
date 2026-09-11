import type { SubmissionJobData, SubmissionJobResult } from '@indexrocket/types';
import { Queue, type JobsOptions } from 'bullmq';

import { getRedisConnection, type RedisConnectionOptions } from '../redis.js';

/**
 * Bulk submission runs on its own queue for the same reason discovery does: a
 * BullMQ worker consumes exactly one queue and its concurrency and rate limit
 * are per worker. A large batch must not be able to starve interactive
 * inspection, and batch throughput must be tunable on its own.
 */
export const SUBMISSION_QUEUE_NAME = 'submission';

export const SUBMISSION_JOB = 'batch-item';

/**
 * Transient failures are retried with backoff. Permanent ones are raised as
 * UnrecoverableError by the processor, which stops the attempts immediately.
 */
export const SUBMISSION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800, count: 1_000 },
};

let queue: Queue<SubmissionJobData, SubmissionJobResult> | null = null;

export function getSubmissionQueue(
  options: RedisConnectionOptions = {},
): Queue<SubmissionJobData, SubmissionJobResult> {
  if (queue === null) {
    queue = new Queue<SubmissionJobData, SubmissionJobResult>(SUBMISSION_QUEUE_NAME, {
      connection: getRedisConnection(options),
      defaultJobOptions: SUBMISSION_JOB_OPTIONS,
    });
  }

  return queue;
}

/**
 * Enqueues one item.
 *
 * The BullMQ job id IS the item id, so re-enqueuing the same item (a double
 * submit, a retried API call, a replayed request) is ignored by Redis instead of
 * creating a second job. BullMQ forbids ":" in a custom id, and an item id is
 * already unique, so it is used verbatim.
 */
export async function addSubmissionJob(data: SubmissionJobData): Promise<string> {
  const job = await getSubmissionQueue().add(SUBMISSION_JOB, data, { jobId: data.itemId });

  return job.id ?? data.itemId;
}

export async function closeSubmissionQueue(): Promise<void> {
  if (queue === null) {
    return;
  }

  const current = queue;
  queue = null;
  await current.close();
}
