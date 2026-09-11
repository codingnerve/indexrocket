import type { Server } from 'node:http';

import { connectDatabase, disconnectDatabase } from '@indexrocket/database';
import {
  closeDiscoveryQueue,
  closeIndexingQueue,
  closeSubmissionQueue,
  connectRedis,
  disconnectRedis,
} from '@indexrocket/queue';
import { runShutdown } from '@indexrocket/utils';

import { createApp } from './app.js';
import { env } from './config/env.js';

/** Bounded so a deploy never hangs on a request that will not finish. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Stops accepting new connections; in-flight requests finish first.
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function bootstrap(): Promise<void> {
  await connectDatabase({ uri: env.mongodbUri });
  await connectRedis({ url: env.redisUrl });

  const app = createApp();

  const onListening = (): void => {
    console.log(`IndexRocket API listening on ${env.host ?? 'all interfaces'}, port ${env.port} [${env.nodeEnv}]`);
  };
  const server =
    env.host === null ? app.listen(env.port, onListening) : app.listen(env.port, env.host, onListening);

  // Longer than a typical proxy upstream keep-alive, so the proxy (not Node)
  // closes idle sockets and never sends a request onto a closing connection.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}, shutting down IndexRocket API.`);

    void runShutdown(
      [
        { name: 'stop accepting connections and finish in-flight requests', run: () => closeServer(server) },
        {
          name: 'close queue producers',
          run: () => Promise.all([closeIndexingQueue(), closeDiscoveryQueue(), closeSubmissionQueue()]),
        },
        { name: 'close redis', run: disconnectRedis },
        { name: 'close mongodb', run: disconnectDatabase },
      ],
      { timeoutMs: SHUTDOWN_TIMEOUT_MS, log: (message) => console.log(message) },
    ).then((result) => {
      if (result.timedOut) {
        console.error(`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms; exiting anyway.`);
      }

      process.exit(result.ok ? 0 : 1);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start IndexRocket API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
