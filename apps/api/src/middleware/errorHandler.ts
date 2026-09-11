import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { isHttpError } from './httpError.js';

interface ErrorResponse {
  success: false;
  message: string;
  /** Lets a user report an id that maps to exactly one server-side log line. */
  requestId?: string;
  stack?: string;
}

/**
 * Body-parser and friends throw http-errors carrying a 4xx status with
 * `expose: true`. Those are client mistakes (malformed JSON, oversized body),
 * not server faults, and must not surface as 500.
 */
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : null;

  return status !== null && status >= 400 && status < 500 && candidate.expose === true ? status : null;
}

/** Fixed messages: the parser's own text can quote fragments of the request body. */
function clientErrorMessage(status: number, error: unknown): string {
  const type = (error as { type?: unknown }).type;

  if (type === 'entity.parse.failed') {
    return 'Malformed JSON body.';
  }

  if (status === 413) {
    return 'Request body too large.';
  }

  if (status === 415) {
    return 'Unsupported content type.';
  }

  return 'Bad request.';
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  let statusCode: number;
  let message: string;

  if (isHttpError(error)) {
    statusCode = error.statusCode;
    message = error.message;
  } else {
    const client = clientErrorStatus(error);

    if (client !== null) {
      statusCode = client;
      message = clientErrorMessage(client, error);
    } else {
      // Unexpected failures never leak internal details to clients.
      statusCode = 500;
      message = 'Internal server error';
    }
  }

  const body: ErrorResponse = { success: false, message };

  if (req.requestId !== undefined) {
    body.requestId = req.requestId;
  }

  // Stack traces are a local debugging aid only; production responses never carry one.
  if (!env.isProduction && statusCode >= 500 && error instanceof Error && error.stack !== undefined) {
    body.stack = error.stack;
  }

  if (statusCode >= 500) {
    // Server-side only: error name, message and stack. Never request bodies,
    // headers or cookies, which is where credentials would live.
    const summary = error instanceof Error ? `${error.name}: ${error.message}` : 'Non-Error value thrown';
    console.error(`[${req.requestId ?? '-'}] ${summary}`);

    if (error instanceof Error && error.stack !== undefined) {
      console.error(error.stack);
    }
  }

  res.status(statusCode).json(body);
}
