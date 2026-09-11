import { GoogleConnection } from '@indexrocket/database';
import {
  GoogleConnectionError,
  loadConnection,
  resolveAccessToken,
  storeTokens,
  type GoogleRuntime,
  type GoogleTokenSet,
} from '@indexrocket/google';
import type { GoogleConnectionView } from '@indexrocket/types';
import { decryptSecret } from '@indexrocket/utils';
import { Types } from 'mongoose';

import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/httpError.js';

/**
 * API-side wrapper around the shared Google connection logic.
 *
 * The token handling itself lives in @indexrocket/google so the worker uses the
 * exact same refresh path; this file only supplies the runtime configuration and
 * maps the shared error onto an HTTP status.
 */
export function googleRuntime(): GoogleRuntime {
  if (env.google === null) {
    throw new HttpError(503, 'Google integration is not configured on this server.');
  }

  return { config: env.google, encryptionKey: env.encryptionKey };
}

function toHttp(error: unknown): never {
  if (error instanceof GoogleConnectionError) {
    throw new HttpError(error.recoverable ? 502 : 409, error.message);
  }

  throw error;
}

export async function saveConnection(
  userId: string,
  tokens: GoogleTokenSet,
  googleAccountId: string | null,
): Promise<void> {
  await storeTokens(userId, tokens, googleAccountId, googleRuntime());
}

export async function getValidAccessToken(userId: string): Promise<string> {
  try {
    return await resolveAccessToken(userId, googleRuntime());
  } catch (error) {
    return toHttp(error);
  }
}

/** Public, token-free view of the connection. */
export async function getConnectionView(userId: string): Promise<GoogleConnectionView> {
  const connection = await GoogleConnection.findOne({ userId: new Types.ObjectId(userId) });

  if (connection === null) {
    return {
      connected: false,
      status: null,
      googleAccountId: null,
      scopes: [],
      expiresAt: null,
      connectedAt: null,
    };
  }

  return {
    connected: connection.status === 'connected',
    status: connection.status,
    googleAccountId: connection.googleAccountId ?? null,
    scopes: connection.scopes,
    expiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    connectedAt: connection.createdAt.toISOString(),
  };
}

export async function getRefreshTokenForRevocation(userId: string): Promise<string | null> {
  const connection = await loadConnection(userId);

  if (connection?.refreshTokenEncrypted == null) {
    return null;
  }

  try {
    return decryptSecret(connection.refreshTokenEncrypted, env.encryptionKey);
  } catch {
    return null;
  }
}

export async function deleteConnection(userId: string): Promise<void> {
  await GoogleConnection.deleteOne({ userId: new Types.ObjectId(userId) });
}
