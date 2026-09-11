import {
  getDatabaseStatus,
  isDatabaseConnected,
  pingDatabase,
  type DatabaseStatus,
} from '@indexrocket/database';
import { getRedisStatus, isRedisConnected, pingRedis, type RedisStatus } from '@indexrocket/queue';
import type { NextFunction, Request, Response } from 'express';

export interface HealthResponse {
  success: boolean;
  message: string;
  database: DatabaseStatus;
  redis: RedisStatus;
  timestamp: string;
}

/**
 * Application health: the process is up and its connections report healthy.
 * Cheap (no round trip), so it is safe for frequent external uptime checks.
 */
export function getHealth(_req: Request, res: Response<HealthResponse>): void {
  const database = getDatabaseStatus();
  const redis = getRedisStatus();
  const healthy = isDatabaseConnected() && isRedisConnected();

  const unavailable = [
    isDatabaseConnected() ? null : 'database',
    isRedisConnected() ? null : 'redis',
  ].filter((name): name is string => name !== null);

  res.setHeader('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    message: healthy
      ? 'IndexRocket API is running'
      : `IndexRocket API is degraded: ${unavailable.join(', ')} unavailable`,
    database,
    redis,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Readiness: a real round trip to every required dependency. A load balancer
 * should route traffic here only when this answers 200. It reports ok/fail per
 * dependency and nothing else: no hosts, ports, versions or credentials.
 */
export async function getReady(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    const ready = database && redis;

    res.setHeader('Cache-Control', 'no-store');
    res.status(ready ? 200 : 503).json({
      success: ready,
      ready,
      checks: { database: database ? 'ok' : 'fail', redis: redis ? 'ok' : 'fail' },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
