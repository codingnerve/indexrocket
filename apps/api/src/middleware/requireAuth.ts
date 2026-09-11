import { User } from '@indexrocket/database';
import type { NextFunction, Request, Response } from 'express';

import { readSession, SESSION_COOKIE } from '../services/auth/sessionStore.js';
import { HttpError } from './httpError.js';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  namespace Express {
    interface Request {
      /** Set only by requireAuth, only from a valid server-side session. */
      auth?: AuthenticatedUser;
      /** The session id backing `auth`, needed by logout. */
      sessionId?: string;
    }
  }
}

/**
 * Resolves the authenticated user from the server-side session cookie.
 *
 * The identity comes exclusively from the session record in Redis. No request
 * header, body field or query parameter can influence who the request runs as:
 * `x-user-id` is not read anywhere in this path and carries no authority.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];

    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new HttpError(401, 'Authentication required.');
    }

    const session = await readSession(sessionId);

    if (session === null) {
      throw new HttpError(401, 'Session is invalid or has expired.');
    }

    const user = await User.findById(session.userId).select('_id name email role');

    if (user === null) {
      // The account was deleted while the session was alive.
      throw new HttpError(401, 'Session is invalid or has expired.');
    }

    req.auth = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };
    req.sessionId = sessionId;

    next();
  } catch (error) {
    next(error);
  }
}

/** Reads the authenticated user, or fails loudly if a route forgot requireAuth. */
export function authenticatedUser(req: Request): AuthenticatedUser {
  if (req.auth === undefined) {
    throw new HttpError(401, 'Authentication required.');
  }

  return req.auth;
}
