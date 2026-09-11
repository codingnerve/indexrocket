import { createServer, type Server } from 'node:http';

import { pingDatabase } from '@indexrocket/database';
import { pingRedis } from '@indexrocket/queue';

export interface WorkerHealthState {
  /** False once shutdown has begun, so a supervisor stops routing work here. */
  accepting: () => boolean;
}

/**
 * Minimal health endpoint for the worker, which otherwise has no HTTP surface.
 *
 *   GET /health -> 200 while the process is alive
 *   GET /ready  -> 200 only when MongoDB and Redis answer a real ping and the
 *                  queue workers are running
 *
 * Bound to loopback by default: it exists for the local process supervisor and
 * monitoring agent, not for the internet. Responses carry ok/fail flags only.
 */
export function startHealthServer(host: string, port: number, state: WorkerHealthState): Server | null {
  if (port === 0) {
    return null;
  }

  const server = createServer((req, res) => {
    const send = (status: number, body: Record<string, unknown>): void => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET') {
      send(405, { ok: false });
      return;
    }

    if (req.url === '/health') {
      send(200, { ok: true, service: 'worker', accepting: state.accepting() });
      return;
    }

    if (req.url === '/ready') {
      void Promise.all([pingDatabase(), pingRedis()]).then(([database, redis]) => {
        const accepting = state.accepting();
        const ready = database && redis && accepting;

        send(ready ? 200 : 503, {
          ok: ready,
          checks: {
            database: database ? 'ok' : 'fail',
            redis: redis ? 'ok' : 'fail',
            workers: accepting ? 'running' : 'stopping',
          },
        });
      });
      return;
    }

    send(404, { ok: false });
  });

  // The health endpoint is auxiliary: failing to bind must not stop job processing.
  server.on('error', (error) => {
    console.error(`Worker health endpoint unavailable on ${host}:${port}: ${error.message}`);
  });

  server.listen(port, host, () => {
    console.log(`Worker health endpoint on http://${host}:${port}/health`);
  });

  return server;
}
