import type { DiscoveryJobData, DiscoveryJobResult } from '@indexrocket/types';
import { Queue, type JobsOptions } from 'bullmq';

import { getRedisConnection, type RedisConnectionOptions } from '../redis.js';

/**
 * Discovery runs on its own queue rather than as a second job type on `indexing`.
 *
 * A BullMQ Worker consumes exactly one queue, and both concurrency and the rate
 * limiter are configured per Worker. Sharing one queue would therefore force
 * discovery and inspection to share a single rate limit and worker pool, which is
 * wrong in both directions: outbound notifications must be throttled to respect a
 * provider's limits, while inspection should stay free to run wide. Separating
 * them also stops a slow or rate-limited provider from starving inspection.
 */
export const DISCOVERY_QUEUE_NAME = 'discovery';

export const URL_DISCOVERY_JOB = 'url-discovery';

/**
 * Notifications are retried a few times with a long backoff. Provider rejections
 * that cannot succeed on retry are surfaced as UnrecoverableError by the worker,
 * which stops the attempts immediately.
 */
export const DISCOVERY_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 200 },
  removeOnFail: { age: 604_800, count: 500 },
};

let queue: Queue<DiscoveryJobData, DiscoveryJobResult> | null = null;

export function getDiscoveryQueue(
  options: RedisConnectionOptions = {},
): Queue<DiscoveryJobData, DiscoveryJobResult> {
  if (queue === null) {
    queue = new Queue<DiscoveryJobData, DiscoveryJobResult>(DISCOVERY_QUEUE_NAME, {
      connection: getRedisConnection(options),
      defaultJobOptions: DISCOVERY_JOB_OPTIONS,
    });
  }

  return queue;
}

/** Enqueues a discovery notification and returns the BullMQ job id. */
export async function addDiscoveryJob(data: DiscoveryJobData): Promise<string> {
  const job = await getDiscoveryQueue().add(URL_DISCOVERY_JOB, data);

  if (job.id === undefined) {
    throw new Error('BullMQ did not return a job id for the queued discovery job.');
  }

  return job.id;
}

export async function closeDiscoveryQueue(): Promise<void> {
  if (queue === null) {
    return;
  }

  const current = queue;
  queue = null;
  await current.close();
}
