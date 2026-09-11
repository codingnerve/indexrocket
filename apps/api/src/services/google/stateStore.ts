import { getRedisConnection } from '@indexrocket/queue';
import { generateSecureToken, safeEquals } from '@indexrocket/utils';

/**
 * OAuth state values live in the Redis instance the queue already uses, so no
 * second store is introduced. State is single-use and short-lived: it is deleted
 * the moment it is consumed, which makes replay impossible.
 */
const STATE_PREFIX = 'oauth:google:state:';
const STATE_TTL_SECONDS = 600;

export interface OAuthStatePayload {
  userId: string;
  createdAt: string;
}

export async function createOAuthState(userId: string): Promise<string> {
  const state = generateSecureToken(32);
  const payload: OAuthStatePayload = { userId, createdAt: new Date().toISOString() };

  await getRedisConnection().set(
    `${STATE_PREFIX}${state}`,
    JSON.stringify(payload),
    'EX',
    STATE_TTL_SECONDS,
  );

  return state;
}

/**
 * Consumes a state value. Returns null when it is unknown, already used or
 * expired — all of which must abort the callback.
 */
export async function consumeOAuthState(state: string): Promise<OAuthStatePayload | null> {
  if (typeof state !== 'string' || state.trim() === '') {
    return null;
  }

  const redis = getRedisConnection();
  const key = `${STATE_PREFIX}${state}`;

  // GETDEL makes consumption atomic: two concurrent callbacks cannot both win.
  const raw = await redis.getdel(key);

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as OAuthStatePayload).userId !== 'string'
    ) {
      return null;
    }

    return parsed as OAuthStatePayload;
  } catch {
    return null;
  }
}

/** Exported for tests: constant-time comparison of two state values. */
export function statesMatch(a: string, b: string): boolean {
  return safeEquals(a, b);
}
