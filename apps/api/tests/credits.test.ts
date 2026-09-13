import type { Request } from 'express';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readRegistrationInput } from '../src/controllers/auth.controller.js';
import { HttpError } from '../src/middleware/httpError.js';
import { apiRouter } from '../src/routes/index.js';
import {
  assertCreditAmount,
  consumeCredits,
  debitFilter,
  debitUpdate,
  hasUnlimitedCredits,
  InsufficientCreditsError,
  isAdmin,
  requestHasUnlimitedCredits,
  requireCredits,
  type CreditAccount,
  type CreditStore,
} from '../src/services/billing/credits.js';

const ADMIN_ID = '6aa000000000000000000001';
const USER_ID = '6aa000000000000000000002';

/**
 * In-memory store with the same semantics as the MongoDB store: the debit is
 * atomic and refuses admins and insufficient balances. Every debit attempt is
 * recorded so tests can prove an admin account is never touched.
 */
function memoryStore(accounts: Record<string, CreditAccount>) {
  const debitCalls: Array<{ userId: string; amount: number }> = [];

  const store: CreditStore = {
    async load(userId) {
      const account = accounts[userId];

      return account === undefined ? null : { ...account };
    },
    async debit(userId, amount) {
      debitCalls.push({ userId, amount });
      const account = accounts[userId];

      if (account === undefined || isAdmin(account) || account.credits < amount) {
        return null;
      }

      account.credits -= amount;

      return account.credits;
    },
  };

  return { store, accounts, debitCalls };
}

function fakeRequest(parts: { auth?: { role: string }; body?: unknown; headers?: Record<string, string> }): Request {
  return {
    auth: parts.auth === undefined ? undefined : { id: USER_ID, name: 'Test', email: 't@example.test', role: parts.auth.role },
    body: parts.body ?? {},
    headers: parts.headers ?? {},
    query: {},
  } as unknown as Request;
}

describe('admin has unlimited credits', () => {
  it('treats exactly role "admin" as admin with unlimited credits', () => {
    assert.equal(isAdmin({ role: 'admin' }), true);
    assert.equal(hasUnlimitedCredits({ role: 'admin' }), true);
  });

  it('does not treat look-alike or missing roles as admin', () => {
    for (const role of ['user', 'Admin', 'ADMIN', ' admin', 'admin ', '', undefined, null, ['admin'], { role: 'admin' }, 1]) {
      assert.equal(hasUnlimitedCredits({ role }), false, `role ${JSON.stringify(role)}`);
    }

    assert.equal(hasUnlimitedCredits(null), false);
    assert.equal(hasUnlimitedCredits(undefined), false);
  });
});

describe('admin credit checks always succeed', () => {
  it('passes requireCredits for any valid amount, even with a zero balance', () => {
    for (const amount of [1, 50, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      assert.doesNotThrow(() => requireCredits({ role: 'admin', credits: 0 }, amount));
    }
  });

  it('succeeds consumeCredits and reports the charge as unlimited', async () => {
    const { store } = memoryStore({ [ADMIN_ID]: { role: 'admin', credits: 0 } });

    assert.deepEqual(await consumeCredits(ADMIN_ID, 250, store), { unlimited: true, charged: 0, remaining: null });
  });
});

describe('admin credits are never decremented', () => {
  it('never attempts a debit for an admin and leaves the stored balance unchanged', async () => {
    const { store, accounts, debitCalls } = memoryStore({ [ADMIN_ID]: { role: 'admin', credits: 40 } });

    for (let i = 0; i < 25; i += 1) {
      await consumeCredits(ADMIN_ID, 10, store);
    }

    assert.equal(debitCalls.length, 0);
    assert.equal(accounts[ADMIN_ID]!.credits, 40);
  });

  it('excludes admins in the database debit filter itself', () => {
    const filter = debitFilter(USER_ID, 5);

    assert.deepEqual(filter.role, { $ne: 'admin' });
    assert.deepEqual(filter.credits, { $gte: 5 });
    assert.equal(String(filter._id), USER_ID);
  });

  it('never writes a non-finite value', () => {
    assert.deepEqual(debitUpdate(5), { $inc: { credits: -5 } });

    for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => assertCreditAmount(amount), RangeError, `amount ${String(amount)}`);
    }
  });
});

describe('normal user credit checks still work', () => {
  it('allows spending up to the exact balance', () => {
    assert.doesNotThrow(() => requireCredits({ role: 'user', credits: 5 }, 5));
    assert.doesNotThrow(() => requireCredits({ role: 'user', credits: 5 }, 1));
  });

  it('decrements the balance by exactly the charged amount', async () => {
    const { store, accounts } = memoryStore({ [USER_ID]: { role: 'user', credits: 5 } });

    assert.deepEqual(await consumeCredits(USER_ID, 2, store), { unlimited: false, charged: 2, remaining: 3 });
    assert.equal(accounts[USER_ID]!.credits, 3);
  });

  it('can never be overspent by concurrent charges', async () => {
    const { store, accounts } = memoryStore({ [USER_ID]: { role: 'user', credits: 1 } });

    const results = await Promise.allSettled([consumeCredits(USER_ID, 1, store), consumeCredits(USER_ID, 1, store)]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(accounts[USER_ID]!.credits, 0);
  });
});

describe('normal user with insufficient credits still fails', () => {
  it('rejects requireCredits with a 402 and a readable message', () => {
    assert.throws(
      () => requireCredits({ role: 'user', credits: 1 }, 2),
      (error: unknown) =>
        error instanceof InsufficientCreditsError &&
        error.statusCode === 402 &&
        error.required === 2 &&
        error.available === 1 &&
        /Not enough credits/.test(error.message),
    );
  });

  it('rejects consumeCredits and leaves the balance untouched', async () => {
    const { store, accounts } = memoryStore({ [USER_ID]: { role: 'user', credits: 1 } });

    await assert.rejects(consumeCredits(USER_ID, 2, store), InsufficientCreditsError);
    assert.equal(accounts[USER_ID]!.credits, 1);
  });

  it('rejects an account with a zero balance, as every new account starts', async () => {
    const { store } = memoryStore({ [USER_ID]: { role: 'user', credits: 0 } });

    await assert.rejects(consumeCredits(USER_ID, 1, store), (error: unknown) => error instanceof HttpError && error.statusCode === 402);
  });

  it('treats a deleted account as signed out, not as a free charge', async () => {
    const { store } = memoryStore({});

    await assert.rejects(consumeCredits(USER_ID, 1, store), (error: unknown) => error instanceof HttpError && error.statusCode === 401);
  });
});

describe('role is taken from the authenticated server-side user', () => {
  it('ignores an admin role claimed in the body, query or headers', () => {
    const req = fakeRequest({
      auth: { role: 'user' },
      body: { role: 'admin', credits: 999_999, unlimitedCredits: true },
      headers: { 'x-user-role': 'admin', 'x-role': 'admin' },
    });

    assert.equal(requestHasUnlimitedCredits(req), false);
  });

  it('grants unlimited credits when the session user is an admin', () => {
    assert.equal(requestHasUnlimitedCredits(fakeRequest({ auth: { role: 'admin' } })), true);
  });

  it('fails for an unauthenticated request instead of falling back to request data', () => {
    const req = fakeRequest({ body: { role: 'admin' }, headers: { 'x-user-role': 'admin' } });

    assert.throws(() => requestHasUnlimitedCredits(req), (error: unknown) => error instanceof HttpError && error.statusCode === 401);
  });

  it('re-reads role and balance from the store when charging, so a stale or forged role cannot help', async () => {
    // The caller can only pass an id; the stored account is a normal user with nothing to spend.
    const { store } = memoryStore({ [USER_ID]: { role: 'user', credits: 0 } });

    await assert.rejects(consumeCredits(USER_ID, 1, store), InsufficientCreditsError);
  });

  it('treats a role promoted to admin between checks as unlimited, not as a failure', async () => {
    const accounts: Record<string, CreditAccount> = { [USER_ID]: { role: 'user', credits: 0 } };
    const { store } = memoryStore(accounts);
    const racing: CreditStore = {
      load: store.load,
      async debit(userId, amount) {
        accounts[USER_ID]!.role = 'admin';

        return await store.debit(userId, amount);
      },
    };

    assert.deepEqual(await consumeCredits(USER_ID, 1, racing), { unlimited: true, charged: 0, remaining: null });
    assert.equal(accounts[USER_ID]!.credits, 0);
  });
});

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouterLayer[] };
}

function listRoutes(stack: RouterLayer[]): string[] {
  const routes: string[] = [];

  for (const layer of stack) {
    if (layer.route !== undefined) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    } else if (layer.handle?.stack !== undefined) {
      routes.push(...listRoutes(layer.handle.stack));
    }
  }

  return routes;
}

describe('a user cannot change their own role', () => {
  it('ignores role, credits and plan submitted at registration', () => {
    const input = readRegistrationInput({
      name: '  New Person  ',
      email: 'new.person@example.test',
      password: 'a-long-enough-password',
      role: 'admin',
      credits: 1_000_000,
      plan: 'agency',
      unlimitedCredits: true,
    });

    assert.deepEqual(Object.keys(input).sort(), ['email', 'name', 'password']);
    assert.equal(input.name, 'New Person');
  });

  it('exposes no endpoint that modifies a user, role or credits', () => {
    const routes = listRoutes((apiRouter as unknown as { stack: RouterLayer[] }).stack);

    assert.ok(routes.length > 0, 'route table was read');
    assert.equal(
      routes.some((route) => /user|role|credit|admin|promote|plan/i.test(route)),
      false,
      routes.join('\n'),
    );
  });

  it('keeps the set of state-changing routes to a reviewed allowlist', () => {
    const mutating = listRoutes((apiRouter as unknown as { stack: RouterLayer[] }).stack)
      .filter((route) => !/^(GET|HEAD|OPTIONS) /.test(route))
      .sort();

    // Adding a state-changing route must be a deliberate, reviewed change to this list.
    assert.deepEqual(
      mutating,
      [
        'DELETE /:id',
        'DELETE /:projectId/urls/:urlId',
        'DELETE /connection',
        'PATCH /:id',
        'POST /',
        'POST /:id/discover',
        'POST /:projectId/batches',
        'POST /:projectId/batches/:batchId/cancel',
        'POST /:projectId/urls',
        'POST /:projectId/urls/bulk',
        'POST /inspect',
        'POST /login',
        'POST /logout',
        'POST /register',
        'POST /search-console/inspect',
      ].sort(),
    );
  });
});
