import { connectDatabase, disconnectDatabase } from '@indexrocket/database';
import {
  closeDiscoveryQueue,
  closeIndexingQueue,
  closeSubmissionQueue,
  connectRedis,
  disconnectRedis,
  DISCOVERY_QUEUE_NAME,
  INDEXING_QUEUE_NAME,
  SUBMISSION_QUEUE_NAME,
} from '@indexrocket/queue';
import { runShutdown } from '@indexrocket/utils';

import { env } from './config/env.js';
import { createDiscoveryWorker } from './queues/discoveryWorker.js';
import { createIndexingWorker } from './queues/indexingWorker.js';
import { createSubmissionWorker } from './queues/submissionWorker.js';
import { recoverBatches } from './services/batchRecovery.js';
import { startHealthServer } from './services/healthServer.js';

async function bootstrap(): Promise<void> {
  console.log('IndexRocket Worker starting...');

  await connectDatabase({ uri: env.mongodbUri });
  await connectRedis({ url: env.redisUrl });

  let accepting = true;

  const indexingWorker = createIndexingWorker();
  const discoveryWorker = createDiscoveryWorker();
  const submissionWorker = createSubmissionWorker();

  console.log(`Queue "${INDEXING_QUEUE_NAME}" ready`);
  console.log(`Queue "${DISCOVERY_QUEUE_NAME}" ready`);
  console.log(`Queue "${SUBMISSION_QUEUE_NAME}" ready`);
  console.log(`Worker listening [${env.nodeEnv}, concurrency ${env.concurrency}]`);

  const health = startHealthServer(env.healthHost, env.healthPort, { accepting: () => accepting });

  // Resume batches interrupted by a previous crash or deploy. A failure here is
  // logged, never fatal: the queues themselves are already running.
  try {
    const report = await recoverBatches();

    if (report.examined > 0) {
      console.log(`Batch recovery: ${JSON.stringify(report)}`);
    }
  } catch (error) {
    console.error(`Batch recovery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    accepting = false;
    console.log(`Received ${signal}, shutting down IndexRocket Worker.`);

    void runShutdown(
      [
        {
          // close() stops fetching new jobs and waits for in-flight ones to finish.
          name: 'stop taking jobs and drain in-flight jobs',
          run: () => Promise.all([indexingWorker.close(), discoveryWorker.close(), submissionWorker.close()]),
        },
        {
          name: 'close queue producers',
          run: () => Promise.all([closeIndexingQueue(), closeDiscoveryQueue(), closeSubmissionQueue()]),
        },
        { name: 'close redis', run: disconnectRedis },
        { name: 'close mongodb', run: disconnectDatabase },
        {
          name: 'close health endpoint',
          run: () =>
            new Promise<void>((resolve) => {
              if (health === null) {
                resolve();
                return;
              }

              health.close(() => resolve());
            }),
        },
      ],
      { timeoutMs: env.shutdownTimeoutMS, log: (message) => console.log(message) },
    ).then((result) => {
      if (result.timedOut) {
        // Jobs still running are not lost: their locks expire, BullMQ moves them
        // back to waiting, and startup recovery reconciles their batches.
        console.error(
          `Shutdown did not finish within ${env.shutdownTimeoutMS} ms; exiting. Unfinished jobs will be retried.`,
        );
      }

      process.exit(result.ok ? 0 : 1);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start IndexRocket Worker:', error instanceof Error ? error.message : error);
  process.exit(1);
});
