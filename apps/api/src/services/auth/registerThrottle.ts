import { getRedisConnection } from '@indexrocket/queue';

/**
 * Account-creation throttle, per client address.
 *
 * Every accepted registration costs a scrypt hash (~0.4 s of CPU and ~128 MiB),
 * so unthrottled registration is a cheap way to exhaust the API. Only
 * registrations that reach hashing are counted: requests rejected by validation
 * or by the duplicate-email check are already cheap.
 */
const PREFIX = 'register:address:';

export const REGISTER_WINDOW_SECONDS = 60 * 60;

export interface RegisterThrottleVerdict {
  blocked: boolean;
  retryAfterSeconds: number;
}

export async function checkRegisterAllowed(address: string, max: number): Promise<RegisterThrottleVerdict> {
  const redis = getRedisConnection();
  const key = `${PREFIX}${address}`;
  const raw = await redis.get(key);
  const count = raw === null ? 0 : Number(raw);

  if (!Number.isFinite(count) || count < max) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const ttl = await redis.ttl(key);

  return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : REGISTER_WINDOW_SECONDS };
}

export async function recordRegistration(address: string): Promise<void> {
  const redis = getRedisConnection();
  const key = `${PREFIX}${address}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, REGISTER_WINDOW_SECONDS);
  }
}
