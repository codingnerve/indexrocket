import { User, type UserDocument, type UserRole } from '@indexrocket/database';
import type { Request } from 'express';
import { Types, type QueryFilter, type UpdateQuery } from 'mongoose';

import { HttpError } from '../../middleware/httpError.js';
import { authenticatedUser } from '../../middleware/requireAuth.js';

/**
 * Credits (billing) policy.
 *
 * This module answers one question — "may this account spend N credits?" —
 * and nothing about WHAT an account may access. Ownership and authorization
 * stay in the ownership service and route guards; being an admin grants
 * unlimited credits here and no additional data access anywhere.
 *
 * Unlimited credits are a property of the stored role, not of a stored number:
 * an admin's `credits` field is never changed and never set to Infinity (which
 * MongoDB cannot store as a meaningful balance).
 */

export const ADMIN_ROLE: UserRole = 'admin';

export interface CreditAccount {
  role: string;
  credits: number;
}

/** Strict comparison: only the exact stored string "admin" is an admin. */
export function isAdmin(user: { role?: unknown } | null | undefined): boolean {
  return user?.role === ADMIN_ROLE;
}

/** Admins have unlimited credits. Kept as its own function so the rule has one home. */
export function hasUnlimitedCredits(user: { role?: unknown } | null | undefined): boolean {
  return isAdmin(user);
}

/**
 * Unlimited-credit status of the request's authenticated user.
 *
 * The role comes only from `req.auth`, which requireAuth fills from the
 * server-side session and the database. Body fields, query parameters and
 * headers are never consulted, and an unauthenticated request fails.
 */
export function requestHasUnlimitedCredits(req: Request): boolean {
  return hasUnlimitedCredits(authenticatedUser(req));
}

export class InsufficientCreditsError extends HttpError {
  readonly required: number;
  readonly available: number;

  constructor(required: number, available: number) {
    super(
      402,
      `Not enough credits. This action needs ${required} ${required === 1 ? 'credit' : 'credits'} and your balance is ${available}.`,
    );
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.available = available;
  }
}

/** A cost is always a positive, finite, safe integer. Anything else is a programming error. */
export function assertCreditAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Credit amount must be a positive safe integer, received ${String(amount)}.`);
  }
}

/**
 * Checks, without spending, that an account can cover `amount`.
 * Admins always pass. Use {@link consumeCredits} to actually charge.
 */
export function requireCredits(account: CreditAccount, amount: number): void {
  assertCreditAmount(amount);

  if (hasUnlimitedCredits(account)) {
    return;
  }

  if (!Number.isFinite(account.credits) || account.credits < amount) {
    throw new InsufficientCreditsError(amount, Number.isFinite(account.credits) ? account.credits : 0);
  }
}

export interface CreditStore {
  /** The stored role and balance, or null when the account no longer exists. */
  load(userId: string): Promise<CreditAccount | null>;
  /**
   * Atomically subtracts `amount` from a NON-admin account holding at least
   * `amount`. Returns the new balance, or null when nothing was changed.
   */
  debit(userId: string, amount: number): Promise<number | null>;
}

export type CreditCharge =
  | { unlimited: true; charged: 0; remaining: null }
  | { unlimited: false; charged: number; remaining: number };

const UNLIMITED: CreditCharge = { unlimited: true, charged: 0, remaining: null };

/** Filter for the atomic debit. Admins are excluded at the database level. */
export function debitFilter(userId: string, amount: number): QueryFilter<UserDocument> {
  return {
    _id: new Types.ObjectId(userId),
    role: { $ne: ADMIN_ROLE },
    credits: { $gte: amount },
  };
}

export function debitUpdate(amount: number): UpdateQuery<UserDocument> {
  return { $inc: { credits: -amount } };
}

export const mongoCreditStore: CreditStore = {
  async load(userId) {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }

    const user = await User.findById(userId).select('role credits').lean();

    return user === null ? null : { role: user.role, credits: user.credits };
  },

  async debit(userId, amount) {
    const updated = await User.findOneAndUpdate(debitFilter(userId, amount), debitUpdate(amount), {
      returnDocument: 'after',
      projection: { credits: 1 },
    }).lean();

    return updated === null ? null : updated.credits;
  },
};

/**
 * Charges `amount` credits to the account identified by `userId`.
 *
 * Always pass the AUTHENTICATED user's id (`authenticatedUser(req).id`); the
 * role and balance are re-read from the database here, never taken from the
 * caller. Admins are never charged. For everyone else the debit is a single
 * conditional update, so concurrent requests can never overspend a balance.
 */
export async function consumeCredits(
  userId: string,
  amount: number,
  store: CreditStore = mongoCreditStore,
): Promise<CreditCharge> {
  assertCreditAmount(amount);

  const account = await store.load(userId);

  if (account === null) {
    throw new HttpError(401, 'Session is invalid or has expired.');
  }

  if (hasUnlimitedCredits(account)) {
    return UNLIMITED;
  }

  const remaining = await store.debit(userId, amount);

  if (remaining !== null) {
    return { unlimited: false, charged: amount, remaining };
  }

  // Nothing was debited: re-read to explain why (the role may have changed
  // to admin between the two reads, which is not a failure).
  const latest = await store.load(userId);

  if (latest === null) {
    throw new HttpError(401, 'Session is invalid or has expired.');
  }

  if (hasUnlimitedCredits(latest)) {
    return UNLIMITED;
  }

  throw new InsufficientCreditsError(amount, latest.credits);
}
