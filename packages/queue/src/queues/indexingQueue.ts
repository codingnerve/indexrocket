import type { UrlInspectionJobData, UrlInspectionJobResult } from '@indexrocket/types';
import { Queue, type JobsOptions } from 'bullmq';

import { getRedisConnection, type RedisConnectionOptions } from '../redis.js';

export const INDEXING_QUEUE_NAME = 'indexing';

/** Job name for a real URL inspection. */
export const URL_INSPECTION_JOB = 'url-inspection';

/** Conservative local-development defaults: retry a few times, keep the queue small. */
export const INDEXING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 100 },
  removeOnFail: { age: 86_400, count: 500 },
};

let queue: Queue<UrlInspectionJobData, UrlInspectionJobResult> | null = null;

/** Returns the shared indexing queue, creating it on first use. */
export function getIndexingQueue(
  options: RedisConnectionOptions = {},
): Queue<UrlInspectionJobData, UrlInspectionJobResult> {
  if (queue === null) {
    queue = new Queue<UrlInspectionJobData, UrlInspectionJobResult>(INDEXING_QUEUE_NAME, {
      connection: getRedisConnection(options),
      defaultJobOptions: INDEXING_JOB_OPTIONS,
    });
  }

  return queue;
}

/** Enqueues a URL inspection and returns the BullMQ job id. */
export async function addUrlInspectionJob(data: UrlInspectionJobData): Promise<string> {
  const job = await getIndexingQueue().add(URL_INSPECTION_JOB, data);

  if (job.id === undefined) {
    throw new Error('BullMQ did not return a job id for the queued inspection job.');
  }

  return job.id;
}

export async function closeIndexingQueue(): Promise<void> {
  if (queue === null) {
    return;
  }

  const current = queue;
  queue = null;
  await current.close();
}
