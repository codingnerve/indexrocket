import { User } from '@indexrocket/database';
import {
  checkPasswordPolicy,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  verifyPassword,
} from '@indexrocket/utils';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { HttpError } from '../middleware/httpError.js';
import {
  checkLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from '../services/auth/loginThrottle.js';
import { checkRegisterAllowed, recordRegistration } from '../services/auth/registerThrottle.js';
import { hasUnlimitedCredits } from '../services/billing/credits.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
} from '../services/auth/sessionStore.js';

interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  /** The stored balance. For admins this number is never spent. */
  credits: number;
  /** Computed server-side from the stored role; clients display it, never decide it. */
  unlimitedCredits: boolean;
}

/** The only user shape that ever leaves the API. passwordHash is not in it. */
function toPublicUser(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  role: string;
  plan: string;
  credits: number;
}): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    credits: user.credits,
    unlimitedCredits: hasUnlimitedCredits(user),
  };
}

/**
 * The only fields registration accepts. Anything else in the body — role,
 * credits, plan — is ignored, so an account can never be created with elevated
 * privileges or a chosen balance; those always take the schema defaults.
 */
export function readRegistrationInput(body: unknown): { name: string; email: string; password: string } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  const { name, email, password } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '' || name.trim().length > 120) {
    throw new HttpError(400, '"name" is required and must be 1-120 characters.');
  }

  if (!isValidEmail(email)) {
    throw new HttpError(400, '"email" must be a valid email address.');
  }

  const policy = checkPasswordPolicy(password);

  if (!policy.valid) {
    throw new HttpError(400, policy.reason);
  }

  return { name: name.trim(), email: email as string, password: password as string };
}

function clientAddress(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  const { email, password } = body as Record<string, unknown>;

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, '"email" and "password" are required.');
  }

  return { email, password };
}

export async function register(
  req: Request,
  res: Response<{ success: true; data: PublicUser }>,
  next: NextFunction,
): Promise<void> {
  try {
    const input = readRegistrationInput(req.body);

    const address = clientAddress(req);
    const throttle = await checkRegisterAllowed(address, env.registerRateMax);

    if (throttle.blocked) {
      res.setHeader('Retry-After', String(throttle.retryAfterSeconds));
      throw new HttpError(429, 'Too many accounts created from this address. Try again later.');
    }

    const normalized = normalizeEmail(input.email);
    const existing = await User.findOne({ email: normalized }).select('_id');

    if (existing !== null) {
      // Registration inherently reveals that an address is taken, because the
      // account cannot be created twice. The message stays neutral in wording and
      // no other detail about the existing account is disclosed.
      throw new HttpError(409, 'That email address cannot be registered.');
    }

    // Only these three fields are written; role, credits and plan take the schema defaults.
    const created = await User.create({
      name: input.name,
      email: normalized,
      passwordHash: await hashPassword(input.password),
    });

    await recordRegistration(address);

    // Registration does not sign the user in: logging in is a separate,
    // rate-limited step, which keeps one code path responsible for sessions.
    res.status(201).json({ success: true, data: toPublicUser(created) });
  } catch (error) {
    next(error);
  }
}

export async function login(
  req: Request,
  res: Response<{ success: true; data: PublicUser }>,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = readCredentials(req.body);
    const normalized = normalizeEmail(email);
    const address = clientAddress(req);

    const throttle = await checkLoginAllowed(normalized, address);

    if (throttle.blocked) {
      res.setHeader('Retry-After', String(throttle.retryAfterSeconds));
      throw new HttpError(429, 'Too many failed login attempts. Try again later.');
    }

    // passwordHash is select:false on the model and must be requested explicitly.
    const user = await User.findOne({ email: normalized }).select('+passwordHash');

    // The same generic message and the same work are used for an unknown account
    // and a wrong password, so the response cannot be used to enumerate accounts.
    const storedHash = user?.passwordHash ?? '';
    const passwordMatches = await verifyPassword(password, storedHash);

    if (user === null || !passwordMatches) {
      await recordLoginFailure(normalized, address);
      throw new HttpError(401, 'Invalid email or password.');
    }

    await clearLoginFailures(normalized);

    // A fresh session id is minted on every login, so a fixed pre-login value
    // cannot be carried into an authenticated session.
    const sessionId = await createSession(user._id.toString());
    setSessionCookie(res, sessionId);

    res.status(200).json({ success: true, data: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
}

/**
 * Destroys the server-side session, so the cookie is worthless afterwards even
 * if a copy of it was captured.
 */
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = (req.cookies as Record<string, string> | undefined)?.['ir_session'];

    if (typeof sessionId === 'string' && sessionId !== '') {
      await destroySession(sessionId);
    }

    clearSessionCookie(res);

    res.status(200).json({ success: true, message: 'Signed out.' });
  } catch (error) {
    next(error);
  }
}

export async function me(
  req: Request,
  res: Response<{ success: true; data: PublicUser }>,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = authenticatedUser(req);
    const user = await User.findById(auth.id);

    if (user === null) {
      throw new HttpError(401, 'Session is invalid or has expired.');
    }

    res.status(200).json({ success: true, data: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
}
