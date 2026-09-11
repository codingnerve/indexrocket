import { DISCOVERY_QUEUE_NAME, getRedisConnection } from '@indexrocket/queue';
import type { DiscoveryJobData, DiscoveryJobResult } from '@indexrocket/types';
import { Worker } from 'bullmq';

import { env } from '../config/env.js';
import { discoveryProcessor } from '../processors/discoveryProcessor.js';

export function createDiscoveryWorker(): Worker<DiscoveryJobData, DiscoveryJobResult> {
  const worker = new Worker<DiscoveryJobData, DiscoveryJobResult>(
    DISCOVERY_QUEUE_NAME,
    discoveryProcessor,
    {
      connection: getRedisConnection({ url: env.redisUrl }),
      // Deliberately low, with a rate limit: this queue talks to third-party
      // search engines and must stay well inside their limits.
      concurrency: env.discoveryConcurrency,
      limiter: {
        max: env.discoveryRateMax,
        duration: env.discoveryRateDurationMS,
      },
    },
  );

  worker.on('completed', (job) => {
    console.log(`✓ Discovery job completed: ${job.id ?? 'unknown'}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`✗ Discovery job failed: ${job?.id ?? 'unknown'} - ${error.message}`);
  });

  worker.on('error', (error) => {
    console.error('Discovery worker error:', error.message);
  });

  return worker;
}
