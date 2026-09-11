import type { GoogleConnectionView } from '@indexrocket/types';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import {
  deleteConnection,
  getConnectionView,
  getRefreshTokenForRevocation,
  saveConnection,
} from '../services/google/connectionService.js';
import { buildAuthorizationUrl, exchangeCodeForTokens, GoogleAuthError, revokeToken } from '@indexrocket/google';
import { consumeOAuthState, createOAuthState } from '../services/google/stateStore.js';

function requireGoogleConfig(): NonNullable<typeof env.google> {
  if (env.google === null) {
    throw new HttpError(
      503,
      'Google integration is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.',
    );
  }

  return env.google;
}

/** Sends the browser to Google's consent screen with a fresh single-use state. */
export async function startGoogleAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = requireGoogleConfig();
    const userId = authenticatedUser(req).id;

    const state = await createOAuthState(userId);
    const authorizationUrl = buildAuthorizationUrl(config, state);

    // JSON by default so the SPA controls navigation; ?redirect=1 for a plain link.
    if (req.query['redirect'] === '1') {
      res.redirect(302, authorizationUrl);
      return;
    }

    res.status(200).json({ success: true, authorizationUrl });
  } catch (error) {
    next(error);
  }
}

/** Builds a frontend URL for the post-callback landing page. Never user-supplied. */
function frontendResultUrl(params: Record<string, string>): string {
  const url = new URL('/google', env.frontendUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

/**
 * OAuth callback. State is validated before the code is exchanged, so a forged
 * callback cannot cause a token exchange.
 */
export async function googleAuthCallback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = requireGoogleConfig();
    const { code, state, error } = req.query;

    if (typeof error === 'string' && error !== '') {
      // The user denied consent, or Google refused. Never a 500.
      res.redirect(302, frontendResultUrl({ connected: 'false', error }));
      return;
    }

    if (typeof state !== 'string' || state === '') {
      throw new HttpError(400, 'Missing OAuth state.');
    }

    const payload = await consumeOAuthState(state);

    if (payload === null) {
      throw new HttpError(400, 'Invalid, expired or already-used OAuth state.');
    }

    if (typeof code !== 'string' || code === '') {
      throw new HttpError(400, 'Missing authorization code.');
    }

    let tokens;

    try {
      tokens = await exchangeCodeForTokens(config, code);
    } catch (exchangeError) {
      // A failed exchange is an expected OAuth outcome (expired code, revoked
      // client, misconfigured credentials), not a server fault. The browser is
      // sent back to the app with a short reason; the detail stays server-side
      // and never includes the client secret or the authorization code.
      const reason = exchangeError instanceof GoogleAuthError ? exchangeError.message : 'token_exchange_failed';

      console.error(`Google OAuth token exchange failed: ${reason}`);
      res.redirect(302, frontendResultUrl({ connected: 'false', error: 'token_exchange_failed' }));
      return;
    }

    // The requested scope grants no identity information, so there is usually no
    // account id to store. It is recorded only when Google actually supplies one.
    await saveConnection(payload.userId, tokens, null);

    res.redirect(302, frontendResultUrl({ connected: 'true' }));
  } catch (error) {
    next(error);
  }
}

export async function googleConnectionStatus(
  req: Request,
  res: Response<{ success: true; data: GoogleConnectionView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;

    res.status(200).json({ success: true, data: await getConnectionView(userId) });
  } catch (error) {
    next(error);
  }
}

export async function disconnectGoogle(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;

    const refreshToken = await getRefreshTokenForRevocation(userId);
    const revoked = refreshToken === null ? false : await revokeToken(refreshToken);

    await deleteConnection(userId);

    res.status(200).json({ success: true, message: 'Google connection removed.', revokedAtGoogle: revoked });
  } catch (error) {
    next(error);
  }
}
