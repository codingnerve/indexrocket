import { Router } from 'express';

import {
  disconnectGoogle,
  googleAuthCallback,
  googleConnectionStatus,
  startGoogleAuth,
} from '../controllers/googleAuth.controller.js';
import {
  getSearchConsoleProperties,
  inspectWithSearchConsole,
} from '../controllers/googleSearchConsole.controller.js';
import { requireAuth } from '../middleware/requireAuth.js';

/**
 * Google OAuth entry points.
 *
 * `start` requires an authenticated IndexRocket session, so a connection is
 * always bound to a known account. The callback cannot require the session
 * cookie in every browser flow, so it is protected by the single-use OAuth state
 * instead, which carries the user id that `start` recorded.
 */
export const googleAuthRouter: Router = Router();

googleAuthRouter.get('/google/start', requireAuth, startGoogleAuth);
googleAuthRouter.get('/google/callback', googleAuthCallback);

/** Search Console operations, each scoped to the authenticated user's connection. */
export const googleRouter: Router = Router();

googleRouter.get('/connection', requireAuth, googleConnectionStatus);
googleRouter.delete('/connection', requireAuth, disconnectGoogle);
googleRouter.get('/search-console/properties', requireAuth, getSearchConsoleProperties);
googleRouter.post('/search-console/inspect', requireAuth, inspectWithSearchConsole);
