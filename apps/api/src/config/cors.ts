import type { CorsOptions } from 'cors';

import { HttpError } from '../middleware/httpError.js';
import { env } from './env.js';

/**
 * Exact-match origin allowlist. The frontend is the only browser origin trusted
 * to call the API with credentials; there is no wildcard and no pattern.
 */
const allowedOrigins: ReadonlySet<string> = new Set([new URL(env.frontendUrl).origin]);

export function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.has(origin);
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests without an Origin header (curl, server-to-server, health probes) are allowed.
    if (origin === undefined || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new HttpError(403, 'Origin is not allowed.'));
  },
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
};
