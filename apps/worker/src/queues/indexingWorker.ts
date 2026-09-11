import {
  INDEXING_QUEUE_NAME,
  getRedisConnection,
} from '@indexrocket/queue';
import type { UrlInspectionJobData, UrlInspectionJobResult } from '@indexrocket/types';
import { Worker } from 'bullmq';

import { env } from '../config/env.js';
import { urlProcessor } from '../processors/urlProcessor.js';

export function createIndexingWorker(): Worker<UrlInspectionJobData, UrlInspectionJobResult> {
  const worker = new Worker<UrlInspectionJobData, UrlInspectionJobResult>(
    INDEXING_QUEUE_NAME,
    urlProcessor,
    {
      connection: getRedisConnection({ url: env.redisUrl }),
      concurrency: env.concurrency,
    },
  );

  worker.on('completed', (job) => {
    console.log(`✓ Job completed: ${job.id ?? 'unknown'}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`✗ Job failed: ${job?.id ?? 'unknown'} - ${error.message}`);
  });

  worker.on('error', (error) => {
    console.error('Worker error:', error.message);
  });

  return worker;
}
