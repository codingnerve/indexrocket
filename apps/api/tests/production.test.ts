import {
  checkApiProductionEnv,
  checkWorkerProductionEnv,
  redactUrlForLog,
  runShutdown,
} from '@indexrocket/utils';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCsrf } from '../src/middleware/csrfGuard.js';

const STRONG_KEY = '3f9a1c7e5b2d8f4a6c0e9b1d7f3a5c8e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a';
const DB_PASSWORD = 'MongoS3cretPass';
const REDIS_PASSWORD = 'RedisS3cretPass';
const FRONTEND = 'https://app.theflyventures.com';

const goodApi = {
  nodeEnv: 'production',
  frontendUrl: FRONTEND,
  encryptionKeyRaw: STRONG_KEY,
  googleConfigured: true,
  googleRedirectUri: 'https://api.theflyventures.com/api/auth/google/callback',
  mongodbUri: `mongodb://indexrocket:${DB_PASSWORD}@127.0.0.1:27017/indexrocket`,
  redisUrl: `redis://:${REDIS_PASSWORD}@127.0.0.1:6379`,
};

const goodWorker = {
  nodeEnv: 'production',
  encryptionKeyRaw: STRONG_KEY,
  indexNowEndpoint: 'https://api.indexnow.org/indexnow',
  googleConfigured: true,
  googleRedirectUri: 'https://api.theflyventures.com/api/auth/google/callback',
  mongodbUri: goodApi.mongodbUri,
  redisUrl: goodApi.redisUrl,
};

function allMessages(result: { errors: string[]; warnings: string[] }): string {
  return [...result.errors, ...result.warnings].join('\n');
}

describe('production environment validation (API)', () => {
  it('accepts a complete production configuration', () => {
    const result = checkApiProductionEnv(goodApi);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('does nothing outside production', () => {
    const result = checkApiProductionEnv({ ...goodApi, nodeEnv: 'development', frontendUrl: 'http://localhost:3000' });

    assert.deepEqual(result.errors, []);
  });

  it('rejects an http or localhost FRONTEND_URL', () => {
    assert.ok(checkApiProductionEnv({ ...goodApi, frontendUrl: 'http://app.theflyventures.com' }).errors.some((e) => e.includes('FRONTEND_URL must use https')));
    assert.ok(checkApiProductionEnv({ ...goodApi, frontendUrl: 'https://localhost:3000' }).errors.some((e) => e.includes('localhost')));
    assert.ok(checkApiProductionEnv({ ...goodApi, frontendUrl: null }).errors.some((e) => e.includes('FRONTEND_URL must be set')));
  });

  it('rejects a missing or placeholder encryption key', () => {
    assert.ok(checkApiProductionEnv({ ...goodApi, encryptionKeyRaw: '' }).errors.some((e) => e.includes('ENCRYPTION_KEY')));
    assert.ok(checkApiProductionEnv({ ...goodApi, encryptionKeyRaw: '0'.repeat(64) }).errors.some((e) => e.includes('ENCRYPTION_KEY')));
  });

  it('rejects an http Google redirect URI in production', () => {
    const result = checkApiProductionEnv({
      ...goodApi,
      googleRedirectUri: 'http://localhost:5000/api/auth/google/callback',
    });

    assert.ok(result.errors.some((e) => e.includes('GOOGLE_REDIRECT_URI')));
  });

  it('warns about Redis without a password', () => {
    const result = checkApiProductionEnv({ ...goodApi, redisUrl: 'redis://127.0.0.1:6379' });

    assert.ok(result.warnings.some((w) => w.includes('REDIS_URL has no password')));
  });

  it('never includes a secret value in any message', () => {
    const noisy = checkApiProductionEnv({
      ...goodApi,
      frontendUrl: 'http://app.theflyventures.com',
      encryptionKeyRaw: 'a'.repeat(64),
      redisUrl: `redis://127.0.0.1:6379`,
    });
    const text = allMessages(noisy);

    assert.equal(text.includes(STRONG_KEY), false);
    assert.equal(text.includes(DB_PASSWORD), false);
    assert.equal(text.includes(REDIS_PASSWORD), false);
    assert.equal(text.includes('a'.repeat(64)), false);
  });
});

describe('production environment validation (worker)', () => {
  it('accepts a complete production configuration', () => {
    assert.deepEqual(checkWorkerProductionEnv(goodWorker).errors, []);
  });

  it('rejects a non-https IndexNow endpoint', () => {
    const result = checkWorkerProductionEnv({ ...goodWorker, indexNowEndpoint: 'http://api.indexnow.org/indexnow' });

    assert.ok(result.errors.some((e) => e.includes('INDEXNOW_ENDPOINT')));
  });

  it('rejects a placeholder encryption key', () => {
    assert.ok(checkWorkerProductionEnv({ ...goodWorker, encryptionKeyRaw: '0'.repeat(64) }).errors.length > 0);
  });
});

describe('log redaction', () => {
  it('redacts OAuth code and state in a request target, keeping other params', () => {
    const out = redactUrlForLog('/api/auth/google/callback?state=abc123&code=4/0Aexample&scope=webmasters');

    assert.equal(out.includes('abc123'), false);
    assert.equal(out.includes('4/0Aexample'), false);
    assert.ok(out.includes('scope=webmasters'));
    assert.ok(out.startsWith('/api/auth/google/callback?'));
  });

  it('strips userinfo, sensitive params and the fragment from absolute URLs', () => {
    const out = redactUrlForLog('https://user:hunter2@example.com/page?token=t0k3n&q=keep#frag');

    assert.equal(out.includes('hunter2'), false);
    assert.equal(out.includes('user:'), false);
    assert.equal(out.includes('t0k3n'), false);
    assert.equal(out.includes('#frag'), false);
    assert.ok(out.includes('q=keep'));
  });

  it('leaves URLs without sensitive params untouched', () => {
    assert.equal(redactUrlForLog('/api/projects?page=2&limit=25'), '/api/projects?page=2&limit=25');
    assert.equal(redactUrlForLog('/api/health'), '/api/health');
  });

  it('never logs an unparseable absolute URL raw', () => {
    assert.equal(redactUrlForLog('http://[not a host/secret'), '[unparseable url]');
  });
});

describe('graceful shutdown orchestration', () => {
  it('runs steps strictly in order', async () => {
    const order: string[] = [];
    const result = await runShutdown(
      [
        { name: 'server', run: async () => { order.push('server'); } },
        { name: 'queues', run: async () => { order.push('queues'); } },
        { name: 'redis', run: async () => { order.push('redis'); } },
        { name: 'mongo', run: async () => { order.push('mongo'); } },
      ],
      { timeoutMs: 1_000 },
    );

    assert.deepEqual(order, ['server', 'queues', 'redis', 'mongo']);
    assert.equal(result.ok, true);
  });

  it('keeps releasing resources after one step fails', async () => {
    const order: string[] = [];
    const result = await runShutdown(
      [
        { name: 'server', run: () => { throw new Error('boom'); } },
        { name: 'mongo', run: async () => { order.push('mongo'); } },
      ],
      { timeoutMs: 1_000 },
    );

    assert.deepEqual(order, ['mongo']);
    assert.deepEqual(result.failed, ['server']);
    assert.equal(result.ok, false);
  });

  it('is bounded by the timeout', async () => {
    const started = Date.now();
    const result = await runShutdown(
      [{ name: 'hangs', run: () => new Promise(() => undefined) }],
      { timeoutMs: 150 },
    );

    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 1_000);
  });
});

describe('CSRF evaluation', () => {
  const allowed = (origin: string): boolean => origin === FRONTEND;

  it('never blocks safe methods', () => {
    assert.deepEqual(evaluateCsrf({ method: 'GET', origin: 'https://evil.example', hasBody: false, isJson: false }, allowed), { ok: true });
  });

  it('rejects a state change from a foreign origin', () => {
    const verdict = evaluateCsrf({ method: 'POST', origin: 'https://evil.example', hasBody: true, isJson: true }, allowed);

    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.status, 403);
  });

  it('rejects a non-JSON body (HTML form carrier)', () => {
    const verdict = evaluateCsrf({ method: 'POST', origin: FRONTEND, hasBody: true, isJson: false }, allowed);

    assert.equal(verdict.ok === false && verdict.status, 415);
  });

  it('allows the frontend and non-browser clients', () => {
    assert.equal(evaluateCsrf({ method: 'POST', origin: FRONTEND, hasBody: true, isJson: true }, allowed).ok, true);
    assert.equal(evaluateCsrf({ method: 'POST', origin: undefined, hasBody: true, isJson: true }, allowed).ok, true);
    assert.equal(evaluateCsrf({ method: 'DELETE', origin: FRONTEND, hasBody: false, isJson: false }, allowed).ok, true);
  });

  it('rejects the sibling main site and the API host itself as origins', () => {
    for (const origin of ['https://theflyventures.com', 'https://www.theflyventures.com', 'https://api.theflyventures.com']) {
      assert.equal(evaluateCsrf({ method: 'POST', origin, hasBody: true, isJson: true }, allowed).ok, false, origin);
    }
  });

  it('rejects a bodiless state change from a foreign origin', () => {
    assert.equal(evaluateCsrf({ method: 'DELETE', origin: 'https://evil.example', hasBody: false, isJson: false }, allowed).ok, false);
  });
});
