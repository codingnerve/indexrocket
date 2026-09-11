import type { NextFunction, Request, Response } from 'express';

import { HttpError } from './httpError.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}
