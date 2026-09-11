import { getRedisConnection } from '@indexrocket/queue';

/**
 * Brute-force protection for login.
 *
 * Two independent counters are kept: one per account and one per client address.
 * The per-account counter stops an attacker grinding a single victim; the per-IP
 * counter stops one client spraying many accounts. Both are recorded on failure
 * only, and the account counter is cleared on a successful login so a legitimate
 * user is never locked out by their own earlier typos.
 */
const ACCOUNT_PREFIX = 'login:fail:account:';
const ADDRESS_PREFIX = 'login:fail:address:';

export const MAX_ACCOUNT_ATTEMPTS = 8;
export const MAX_ADDRESS_ATTEMPTS = 30;
export const WINDOW_SECONDS = 15 * 60;

export interface ThrottleVerdict {
  blocked: boolean;
  retryAfterSeconds: number;
}

async function bump(redisKey: string): Promise<void> {
  const redis = getRedisConnection();
  const count = await redis.incr(redisKey);

  if (count === 1) {
    await redis.expire(redisKey, WINDOW_SECONDS);
  }
}

async function overLimit(redisKey: string, limit: number): Promise<ThrottleVerdict> {
  const redis = getRedisConnection();
  const raw = await redis.get(redisKey);
  const count = raw === null ? 0 : Number(raw);

  if (!Number.isFinite(count) || count < limit) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const ttl = await redis.ttl(redisKey);

  return { blocked: true, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
}

export async function checkLoginAllowed(email: string, address: string): Promise<ThrottleVerdict> {
  const account = await overLimit(`${ACCOUNT_PREFIX}${email}`, MAX_ACCOUNT_ATTEMPTS);

  if (account.blocked) {
    return account;
  }

  return await overLimit(`${ADDRESS_PREFIX}${address}`, MAX_ADDRESS_ATTEMPTS);
}

export async function recordLoginFailure(email: string, address: string): Promise<void> {
  await bump(`${ACCOUNT_PREFIX}${email}`);
  await bump(`${ADDRESS_PREFIX}${address}`);
}

export async function clearLoginFailures(email: string): Promise<void> {
  await getRedisConnection().del(`${ACCOUNT_PREFIX}${email}`);
}
