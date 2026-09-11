import { getRedisConnection } from '@indexrocket/queue';
import { generateSecureToken } from '@indexrocket/utils';
import type { Response } from 'express';

import { env } from '../../config/env.js';

/**
 * Server-side sessions backed by the Redis instance the queue already uses.
 *
 * The cookie carries an opaque 256-bit random identifier and nothing else: no
 * user id, no claims, no signature to verify. The identifier is meaningless
 * without the Redis record, which is why logout can genuinely invalidate a
 * session — deleting the key ends it immediately for every copy of the cookie.
 * A stateless JWT could not do that without a separate denylist, and Phase 6
 * requires real invalidation.
 */
const SESSION_PREFIX = 'session:';

export const SESSION_COOKIE = 'ir_session';

/** Sessions live for 7 days and are refreshed on use (sliding expiry). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionRecord {
  userId: string;
  createdAt: string;
}

function key(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

/** Creates a new session and returns its identifier. */
export async function createSession(userId: string): Promise<string> {
  const sessionId = generateSecureToken(32);
  const record: SessionRecord = { userId, createdAt: new Date().toISOString() };

  await getRedisConnection().set(key(sessionId), JSON.stringify(record), 'EX', SESSION_TTL_SECONDS);

  return sessionId;
}

/**
 * Loads a session and extends its lifetime. Returns null for an unknown,
 * expired or destroyed identifier, which the caller must treat as unauthenticated.
 */
export async function readSession(sessionId: string): Promise<SessionRecord | null> {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return null;
  }

  const redis = getRedisConnection();
  const raw = await redis.get(key(sessionId));

  if (raw === null) {
    return null;
  }

  let record: SessionRecord;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as SessionRecord).userId !== 'string') {
      return null;
    }

    record = parsed as SessionRecord;
  } catch {
    return null;
  }

  // Sliding expiry: an active session does not expire mid-use.
  await redis.expire(key(sessionId), SESSION_TTL_SECONDS);

  return record;
}

export async function destroySession(sessionId: string): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }

  await getRedisConnection().del(key(sessionId));
}

/** Ends every session belonging to a user (used when credentials change). */
export async function destroyAllSessionsForUser(userId: string): Promise<number> {
  const redis = getRedisConnection();
  let cursor = '0';
  let removed = 0;

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${SESSION_PREFIX}*`, 'COUNT', 200);
    cursor = next;

    for (const found of keys) {
      const raw = await redis.get(found);

      if (raw !== null && raw.includes(`"userId":"${userId}"`)) {
        await redis.del(found);
        removed += 1;
      }
    }
  } while (cursor !== '0');

  return removed;
}

/**
 * HttpOnly so client-side JavaScript can never read the session id; Secure in
 * production so it is never sent over plaintext HTTP; SameSite=Lax so it is not
 * attached to cross-site requests that could forge state changes. The frontend
 * and API share the `localhost` site in development, so Lax still permits the
 * dashboard's XHR calls.
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}
