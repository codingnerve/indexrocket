import { GoogleConnection, type GoogleConnectionDocument } from '@indexrocket/database';
import { decryptSecret, encryptSecret } from '@indexrocket/utils';
import { Types } from 'mongoose';

import { GoogleAuthError, refreshAccessToken, type GoogleOAuthConfig, type GoogleTokenSet } from './oauth.js';

/** Refresh a little before expiry so a request never races the deadline. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Raised when a Google connection cannot produce a usable token.
 *
 * `recoverable: false` means the user must reconnect (revoked grant, missing
 * refresh token); `true` means the failure may pass on retry (network, 5xx).
 * Callers map this onto their own transport: the API turns it into an HTTP
 * status, the worker into a permanent or retryable job failure.
 */
export class GoogleConnectionError extends Error {
  readonly recoverable: boolean;

  constructor(message: string, recoverable: boolean) {
    super(message);
    this.name = 'GoogleConnectionError';
    this.recoverable = recoverable;
  }
}

export interface GoogleRuntime {
  config: GoogleOAuthConfig;
  /** 32-byte key used to encrypt the stored tokens. */
  encryptionKey: Buffer;
}

/** Loads a connection including the encrypted token fields. */
export async function loadConnection(userId: string): Promise<GoogleConnectionDocument | null> {
  return await GoogleConnection.findOne({ userId: new Types.ObjectId(userId) }).select(
    '+accessTokenEncrypted +refreshTokenEncrypted',
  );
}

async function markConnection(
  userId: string,
  status: 'expired' | 'revoked' | 'error',
  message: string,
): Promise<void> {
  await GoogleConnection.updateOne(
    { userId: new Types.ObjectId(userId) },
    { $set: { status, lastError: message.slice(0, 500) } },
  );
}

export async function storeTokens(
  userId: string,
  tokens: GoogleTokenSet,
  googleAccountId: string | null,
  runtime: GoogleRuntime,
): Promise<void> {
  await GoogleConnection.findOneAndUpdate(
    { userId: new Types.ObjectId(userId) },
    {
      $set: {
        googleAccountId,
        accessTokenEncrypted: encryptSecret(tokens.accessToken, runtime.encryptionKey),
        refreshTokenEncrypted:
          tokens.refreshToken === null ? null : encryptSecret(tokens.refreshToken, runtime.encryptionKey),
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: 'connected',
        lastError: null,
      },
      $setOnInsert: { userId: new Types.ObjectId(userId) },
    },
    { upsert: true, returnDocument: 'after' },
  );
}

/**
 * Returns a usable access token for a user, refreshing it when expired.
 *
 * This is the single implementation shared by the API and the worker, so a batch
 * job and an interactive request behave identically and neither carries its own
 * copy of the refresh logic.
 */
export async function resolveAccessToken(userId: string, runtime: GoogleRuntime): Promise<string> {
  const connection = await loadConnection(userId);

  if (connection === null) {
    throw new GoogleConnectionError('No Google account is connected.', false);
  }

  if (connection.status === 'revoked') {
    throw new GoogleConnectionError('The Google connection was revoked. Reconnect Search Console.', false);
  }

  const expiresAt = connection.accessTokenExpiresAt ?? null;
  const stillValid =
    connection.accessTokenEncrypted != null &&
    expiresAt !== null &&
    expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();

  if (stillValid && connection.accessTokenEncrypted != null) {
    return decryptSecret(connection.accessTokenEncrypted, runtime.encryptionKey);
  }

  if (connection.refreshTokenEncrypted == null) {
    await markConnection(userId, 'expired', 'Access token expired and no refresh token is stored.');
    throw new GoogleConnectionError(
      'The Google access token expired and cannot be refreshed. Reconnect Search Console.',
      false,
    );
  }

  const refreshToken = decryptSecret(connection.refreshTokenEncrypted, runtime.encryptionKey);

  try {
    const refreshed = await refreshAccessToken(runtime.config, refreshToken);

    await GoogleConnection.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          accessTokenEncrypted: encryptSecret(refreshed.accessToken, runtime.encryptionKey),
          refreshTokenEncrypted:
            refreshed.refreshToken === null
              ? null
              : encryptSecret(refreshed.refreshToken, runtime.encryptionKey),
          accessTokenExpiresAt: refreshed.expiresAt,
          status: 'connected',
          lastError: null,
        },
      },
    );

    return refreshed.accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed.';
    const revoked = error instanceof GoogleAuthError && !error.retryable;

    await markConnection(userId, revoked ? 'revoked' : 'error', message);

    throw new GoogleConnectionError(
      revoked
        ? 'The Google connection is no longer valid. Reconnect Search Console.'
        : `Could not refresh the Google access token: ${message}`,
      !revoked,
    );
  }
}
