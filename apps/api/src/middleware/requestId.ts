import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  namespace Express {
    interface Request {
      /** Correlation id for this request; echoed as X-Request-Id and in error bodies. */
      requestId?: string;
    }
  }
}

/**
 * A proxy-supplied id (Nginx `$request_id`) is kept so one id spans proxy and
 * API logs. It is accepted only in a strict shape, so a client cannot inject
 * newlines or markup into log lines through this header.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
