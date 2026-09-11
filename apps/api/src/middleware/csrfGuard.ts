import type { NextFunction, Request, Response } from 'express';

import { isAllowedOrigin } from '../config/cors.js';
import { HttpError } from './httpError.js';

/**
 * CSRF defence for a cookie-authenticated JSON API.
 *
 * The session cookie is SameSite=Lax, which already stops it riding on
 * cross-site POSTs. This adds two independent checks for state-changing
 * requests, so protection does not rest on a single browser behaviour:
 *
 *  1. Origin: when a browser sends an Origin header, it must be the frontend.
 *     This also covers same-site-but-different-origin callers (another
 *     subdomain), which SameSite alone would let through.
 *  2. Content type: a request that carries a body must be JSON. HTML forms can
 *     only submit urlencoded, multipart or text/plain, and a JSON body from
 *     another origin forces a CORS preflight that the allowlist rejects.
 *
 * Requests without an Origin header (curl, server-to-server, health probes)
 * are not browser-driven and cannot be forged by a third-party page.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  method: string;
  origin: string | undefined;
  hasBody: boolean;
  isJson: boolean;
}

export type CsrfVerdict = { ok: true } | { ok: false; status: 403 | 415; message: string };

export function evaluateCsrf(input: CsrfInput, allowed: (origin: string) => boolean): CsrfVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { ok: true };
  }

  if (input.origin !== undefined && !allowed(input.origin)) {
    return { ok: false, status: 403, message: 'Cross-origin request rejected.' };
  }

  if (input.hasBody && !input.isJson) {
    return { ok: false, status: 415, message: 'Request body must be application/json.' };
  }

  return { ok: true };
}

export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  const length = Number(req.get('content-length') ?? '0');
  const hasBody = (Number.isFinite(length) && length > 0) || req.get('transfer-encoding') !== undefined;

  const verdict = evaluateCsrf(
    {
      method: req.method,
      origin: req.get('origin'),
      hasBody,
      isJson: Boolean(req.is(['application/json', 'application/*+json'])),
    },
    isAllowedOrigin,
  );

  if (verdict.ok) {
    next();
    return;
  }

  next(new HttpError(verdict.status, verdict.message));
}
