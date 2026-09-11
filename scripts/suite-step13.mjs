/**
 * Step 13 production-hardening smoke suite.
 *
 * Part 1 runs against the running development stack (API on :5000, worker with
 * its health endpoint on :5100). Part 2 starts a SEPARATE API process in
 * NODE_ENV=production on :5101 with a throwaway key and verifies the production
 * behaviour directly: config refusal, headers, cookie flags, error shape and
 * trust-proxy handling. All data it creates is removed at the end.
 *
 * Usage:  IR_LOG_DIR=<dir with api.log and worker.log> node scripts/suite-step13.mjs
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = 'C:/Project/indexrocket';
const API = process.env.API_URL ?? 'http://localhost:5000';
const FRONTEND = 'http://localhost:3000';
const WORKER_HEALTH = process.env.WORKER_HEALTH_URL ?? 'http://127.0.0.1:5100';
const LOG_DIR = process.env.IR_LOG_DIR ?? null;
const MONGO = 'mongodb://127.0.0.1:27017/indexrocket';
const REDIS = 'redis://127.0.0.1:6379';

const db = await import(`file:///${ROOT}/packages/database/dist/index.js`);
const queue = await import(`file:///${ROOT}/packages/queue/dist/index.js`);
const mongoose = (await import(`file:///${ROOT}/node_modules/mongoose/index.js`)).default;
const recovery = await import(`file:///${ROOT}/apps/worker/dist/services/batchRecovery.js`);
const progress = await import(`file:///${ROOT}/apps/worker/dist/services/batchProgress.js`);
const registerThrottle = await import(`file:///${ROOT}/apps/api/dist/services/auth/registerThrottle.js`);

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  -> ${detail}` : ''}`);
  }
}

function makeJar() {
  const jar = new Map();

  return {
    store(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    values() {
      return [...jar.values()];
    },
  };
}

async function call(base, jar, route, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };

  if (jar !== null) {
    const cookie = jar.header();
    if (cookie !== '') headers.cookie = cookie;
  }

  const response = await fetch(`${base}${route}`, { ...init, headers });
  if (jar !== null) jar.store(response);

  const text = await response.text();
  let body = {};
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }

  return {
    status: response.status,
    body,
    raw: text,
    headers: Object.fromEntries(response.headers),
    setCookies: response.headers.getSetCookie?.() ?? [],
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now();

await db.connectDatabase({ uri: MONGO });
await queue.connectRedis({ url: REDIS });
const redis = queue.getRedisConnection();

const cleanup = { users: [], projects: [], redisKeys: [] };

// ---------------------------------------------------------------------------
console.log('=== HEALTH / READINESS ===');
let r = await call(API, null, '/api/health');
check('health 200 with dependencies connected', r.status === 200 && r.body.database === 'connected' && r.body.redis === 'connected');
check('health is not cacheable', r.headers['cache-control'] === 'no-store');

r = await call(API, null, '/api/ready');
check('ready 200 after real pings', r.status === 200 && r.body.checks?.database === 'ok' && r.body.checks?.redis === 'ok', r.raw);
check('readiness reveals no infrastructure detail', !/mongodb|redis:\/\/|127\.0\.0\.1|6379|27017|password/i.test(r.raw));

const workerHealth = await fetch(`${WORKER_HEALTH}/health`).then((x) => x.status).catch(() => 0);
const workerReady = await fetch(`${WORKER_HEALTH}/ready`).then(async (x) => ({ status: x.status, body: await x.json() })).catch(() => null);
check('worker /health 200', workerHealth === 200, `got ${workerHealth}`);
check(
  'worker /ready 200 with database, redis and workers ok',
  workerReady?.status === 200 && workerReady.body.checks?.database === 'ok' && workerReady.body.checks?.redis === 'ok' && workerReady.body.checks?.workers === 'running',
  JSON.stringify(workerReady),
);

// ---------------------------------------------------------------------------
console.log('');
console.log('=== REQUEST IDS ===');
r = await call(API, null, '/api/health');
check('X-Request-Id issued', /^[0-9a-f-]{36}$/.test(r.headers['x-request-id'] ?? ''), r.headers['x-request-id']);
r = await call(API, null, '/api/health', { headers: { 'x-request-id': 'deploy-check-12345' } });
check('a well-formed proxy request id is kept', r.headers['x-request-id'] === 'deploy-check-12345');
r = await call(API, null, '/api/health', { headers: { 'x-request-id': '<script>alert(1)</script>' } });
check('an unsafe request id is replaced (no log injection)', /^[0-9a-f-]{36}$/.test(r.headers['x-request-id'] ?? ''));
r = await call(API, null, '/api/definitely-not-a-route');
check('error bodies carry the request id', r.body.requestId !== undefined && r.body.requestId === r.headers['x-request-id']);

// ---------------------------------------------------------------------------
console.log('');
console.log('=== CSRF / BODY HANDLING ===');
const loginBody = JSON.stringify({ email: `nobody-${stamp}@indexrocket.test`, password: 'not-the-password-1' });

r = await call(API, null, '/api/auth/login', { method: 'POST', body: loginBody, headers: { origin: 'https://evil.example' } });
check('state change from a foreign Origin rejected (403)', r.status === 403, `got ${r.status}`);
r = await call(API, null, '/api/auth/login', { method: 'POST', body: loginBody, headers: { origin: FRONTEND } });
check('the frontend Origin passes the guard', r.status === 401, `got ${r.status}`);
r = await call(API, null, '/api/auth/login', { method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' } });
check('text/plain body rejected (415)', r.status === 415, `got ${r.status}`);
r = await call(API, null, '/api/auth/login', { method: 'POST', body: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
check('form-encoded body rejected (415)', r.status === 415, `got ${r.status}`);
r = await call(API, null, '/api/auth/login', { method: 'POST', body: '{"email":' });
check('malformed JSON is a 400, not a 500', r.status === 400 && r.body.message === 'Malformed JSON body.', `${r.status} ${r.body.message}`);
r = await call(API, null, '/api/auth/login', { method: 'POST', body: JSON.stringify({ blob: 'x'.repeat(1_200_000) }) });
check('oversized body is a 413, not a 500', r.status === 413 && r.body.message === 'Request body too large.', `${r.status} ${r.body.message}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('=== REGISTRATION THROTTLE ===');
const throttleAddress = `s13-throttle-${stamp}`;
cleanup.redisKeys.push(`register:address:${throttleAddress}`);
check('first registrations allowed', (await registerThrottle.checkRegisterAllowed(throttleAddress, 2)).blocked === false);
await registerThrottle.recordRegistration(throttleAddress);
await registerThrottle.recordRegistration(throttleAddress);
const verdict = await registerThrottle.checkRegisterAllowed(throttleAddress, 2);
check('blocked once the per-address limit is reached', verdict.blocked && verdict.retryAfterSeconds > 0, JSON.stringify(verdict));

// ---------------------------------------------------------------------------
console.log('');
console.log('=== GOOGLE RESULT OWNERSHIP (fixed cross-user write) ===');
const A = { email: `s13-a-${stamp}@indexrocket.test`, password: 'suite-13-password-A', jar: makeJar() };
const B = { email: `s13-b-${stamp}@indexrocket.test`, password: 'suite-13-password-B', jar: makeJar() };

for (const identity of [A, B]) {
  await call(API, null, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Suite13', email: identity.email, password: identity.password }),
  });
  await call(API, identity.jar, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, password: identity.password }),
  });
  cleanup.users.push(identity.email);
}

const hostA = `s13a-${stamp}.com`;
r = await call(API, A.jar, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'S13 A', domain: hostA }) });
const projectA = r.body?.data?.id;
cleanup.projects.push(projectA);
r = await call(API, A.jar, `/api/projects/${projectA}/urls`, { method: 'POST', body: JSON.stringify({ url: `https://${hostA}/one` }) });
const urlA = r.body?.data;

r = await call(API, B.jar, '/api/google/search-console/inspect', {
  method: 'POST',
  body: JSON.stringify({ inspectionUrl: urlA.url, siteUrl: `https://${hostA}/`, urlId: urlA.id }),
});
check("B cannot target A's URL record for a Google result (404)", r.status === 404, `got ${r.status} ${r.body.message}`);

r = await call(API, A.jar, '/api/google/search-console/inspect', {
  method: 'POST',
  body: JSON.stringify({ inspectionUrl: `https://${hostA}/different`, siteUrl: `https://${hostA}/`, urlId: urlA.id }),
});
check('a urlId that does not match inspectionUrl is rejected (400)', r.status === 400, `got ${r.status} ${r.body.message}`);

r = await call(API, A.jar, '/api/google/search-console/inspect', {
  method: 'POST',
  body: JSON.stringify({ inspectionUrl: urlA.url, siteUrl: `https://${hostA}/`, urlId: 'not-an-id' }),
});
check('a malformed urlId is rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(API, A.jar, '/api/google/search-console/inspect', {
  method: 'POST',
  body: JSON.stringify({ inspectionUrl: urlA.url, siteUrl: `https://${hostA}/`, urlId: urlA.id }),
});
check('the owner passes the ownership check and then needs a Google connection (409)', r.status === 409, `got ${r.status} ${r.body.message}`);

// ---------------------------------------------------------------------------
console.log('');
console.log('=== BATCH RECOVERY AFTER A CRASH ===');
const recUser = await db.User.create({
  name: 'Recovery fixture',
  email: `s13-rec-${stamp}@indexrocket.test`,
  passwordHash: 'fixture-not-a-real-hash',
});
cleanup.users.push(recUser.email);
const recHost = `s13rec-${stamp}.invalid`;
const recProject = await db.Project.create({ userId: recUser._id, name: 'S13 recovery', domain: recHost });
cleanup.projects.push(String(recProject._id));

// An item left "processing" by a crashed worker, with no job left in Redis.
const lostUrl = await db.Url.create({ projectId: recProject._id, url: `https://${recHost}/lost`, status: 'queued' });
const lostBatch = await db.SubmissionBatch.create({
  userId: recUser._id, projectId: recProject._id, status: 'processing', total: 1, pending: 0, processing: 1, inspectGoogle: false,
});
const lostItem = await db.SubmissionBatchItem.create({
  batchId: lostBatch._id, projectId: recProject._id, urlId: lostUrl._id, url: lostUrl.url, status: 'processing', attempts: 1,
});
await mongoose.connection.db
  .collection('submissionbatchitems')
  .updateOne({ _id: lostItem._id }, { $set: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } });
const staleJob = await queue.getSubmissionQueue().getJob(String(lostItem._id));
if (staleJob) await staleJob.remove();

// A pending item whose batch was cancelled while the worker was down.
const cancelledUrl = await db.Url.create({ projectId: recProject._id, url: `https://${recHost}/cancelled`, status: 'queued' });
const cancelledBatch = await db.SubmissionBatch.create({
  userId: recUser._id, projectId: recProject._id, status: 'cancelled', total: 1, pending: 1, inspectGoogle: false, cancelledAt: new Date(),
});
const cancelledItem = await db.SubmissionBatchItem.create({
  batchId: cancelledBatch._id, projectId: recProject._id, urlId: cancelledUrl._id, url: cancelledUrl.url, status: 'pending',
});

const report = await recovery.recoverBatches();
check('recovery re-queued the orphaned in-flight item', report.requeued >= 1, JSON.stringify(report));
check('recovery skipped the cancelled batch item', report.skippedCancelled >= 1, JSON.stringify(report));
check('cancelled item is now skipped', (await db.SubmissionBatchItem.findById(cancelledItem._id).lean()).status === 'skipped');

let lostFinal = null;
for (let i = 0; i < 40; i += 1) {
  lostFinal = await db.SubmissionBatchItem.findById(lostItem._id).lean();
  if (['completed', 'failed', 'skipped'].includes(lostFinal.status)) break;
  await sleep(1500);
}
check('the running worker picked the re-queued item up and finished it', ['completed', 'failed', 'skipped'].includes(lostFinal?.status), lostFinal?.status);
const lostBatchFinal = await db.SubmissionBatch.findById(lostBatch._id).lean();
check('its batch reached a terminal state', ['completed', 'failed', 'completed_with_errors'].includes(lostBatchFinal.status), lostBatchFinal.status);

await recovery.recoverBatches();
check('running recovery again leaves the finished item alone', (await db.SubmissionBatchItem.findById(lostItem._id).lean()).status === lostFinal.status);

console.log('');
console.log('=== RETRIES EXHAUSTED -> ITEM FINALISED ===');
const exUrl = await db.Url.create({ projectId: recProject._id, url: `https://${recHost}/exhausted`, status: 'inspected' });
const exBatch = await db.SubmissionBatch.create({
  userId: recUser._id, projectId: recProject._id, status: 'processing', total: 1, pending: 0, processing: 1, inspectGoogle: false,
});
const exItem = await db.SubmissionBatchItem.create({
  batchId: exBatch._id, projectId: recProject._id, urlId: exUrl._id, url: exUrl.url, status: 'processing', attempts: 3, errorCode: 'provider_transient',
});
check('an exhausted item is finalised', (await progress.finalizeExhaustedItem(String(exItem._id), 'Rate limited by the provider.')) === true);
const exFinal = await db.SubmissionBatchItem.findById(exItem._id).lean();
check('it is failed and keeps its specific error code', exFinal.status === 'failed' && exFinal.errorCode === 'provider_transient', `${exFinal.status} ${exFinal.errorCode}`);
check('its batch is closed as failed', (await db.SubmissionBatch.findById(exBatch._id).lean()).status === 'failed');
check('finalising twice is a no-op', (await progress.finalizeExhaustedItem(String(exItem._id), 'again')) === false);

// ---------------------------------------------------------------------------
console.log('');
console.log('=== PRODUCTION MODE (separate process, NODE_ENV=production) ===');
const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ir-smoke-'));
const ENTRY = `${ROOT}/apps/api/dist/index.js`;
const smokeKey = randomBytes(32).toString('hex');
const baseEnv = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  TEMP: process.env.TEMP ?? '',
  TMP: process.env.TMP ?? '',
};
const prodEnv = {
  ...baseEnv,
  NODE_ENV: 'production',
  PORT: '5101',
  FRONTEND_URL: 'https://app.theflyventures.com',
  MONGODB_URI: MONGO,
  REDIS_URL: REDIS,
  ENCRYPTION_KEY: smokeKey,
};

function start(env) {
  // Started from an empty directory, so no developer .env can leak in.
  const child = spawn(process.execPath, [ENTRY], { cwd: smokeDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}

function waitExit(child, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

let proc = start({ ...prodEnv, FRONTEND_URL: 'http://app.theflyventures.com' });
let code = await waitExit(proc.child, 20_000);
check('refuses to start with an http FRONTEND_URL', code !== null && code !== 0 && proc.output().includes('FRONTEND_URL must use https'), `exit ${code}`);
check('the refusal names the variable, never a secret value', !proc.output().includes(smokeKey));

proc = start({ ...prodEnv, ENCRYPTION_KEY: '' });
code = await waitExit(proc.child, 20_000);
check('refuses to start without ENCRYPTION_KEY', code !== null && code !== 0 && proc.output().includes('ENCRYPTION_KEY'), `exit ${code}`);

proc = start({ ...prodEnv, ENCRYPTION_KEY: '0'.repeat(64) });
code = await waitExit(proc.child, 20_000);
check('refuses to start with a placeholder ENCRYPTION_KEY', code !== null && code !== 0 && proc.output().includes('ENCRYPTION_KEY'), `exit ${code}`);

const prod = start(prodEnv);
const PROD = 'http://127.0.0.1:5101';
let prodReady = false;
for (let i = 0; i < 40 && !prodReady; i += 1) {
  prodReady = await fetch(`${PROD}/api/ready`).then((x) => x.status === 200).catch(() => false);
  if (!prodReady) await sleep(500);
}
check('production process becomes ready with a valid configuration', prodReady, prod.output().slice(-300));

if (prodReady) {
  check('production API binds to loopback by default', prod.output().includes('listening on 127.0.0.1, port 5101'));

  r = await call(PROD, null, '/api/health');
  check('HSTS header present', typeof r.headers['strict-transport-security'] === 'string');
  check('no X-Powered-By header', r.headers['x-powered-by'] === undefined);
  check('Content-Security-Policy header present', typeof r.headers['content-security-policy'] === 'string');

  r = await call(PROD, null, '/api/nope');
  check('production 404 carries no stack and has a request id', !('stack' in r.body) && typeof r.body.requestId === 'string');

  r = await call(PROD, null, '/api/auth/login', { method: 'POST', body: '{bad', headers: { origin: 'https://app.theflyventures.com' } });
  check('production malformed JSON: 400 with no stack', r.status === 400 && !('stack' in r.body), `${r.status}`);

  r = await call(PROD, null, '/api/health', { headers: { origin: 'https://app.theflyventures.com' } });
  check(
    'CORS allows exactly the configured frontend, with credentials',
    r.headers['access-control-allow-origin'] === 'https://app.theflyventures.com' && r.headers['access-control-allow-credentials'] === 'true',
  );
  r = await call(PROD, null, '/api/auth/login', { method: 'POST', body: loginBody, headers: { origin: 'https://evil.example' } });
  check('CORS/CSRF rejects a foreign origin in production (403)', r.status === 403 && !('stack' in r.body));
  r = await call(PROD, null, '/api/auth/login', { method: 'POST', body: loginBody, headers: { origin: 'https://theflyventures.com' } });
  check('the sibling main site theflyventures.com cannot make state changes (403)', r.status === 403);
  r = await call(PROD, null, '/api/health', { headers: { origin: 'https://theflyventures.com' } });
  check('CORS grants the main site no access', r.headers['access-control-allow-origin'] === undefined);

  const forwarded = `198.51.100.${1 + Math.floor(Math.random() * 200)}`;
  cleanup.redisKeys.push(`register:address:${forwarded}`);
  const P = { email: `s13-prod-${stamp}@indexrocket.test`, password: 'prod-smoke-password-1', jar: makeJar() };
  cleanup.users.push(P.email);

  r = await call(PROD, null, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Prod smoke', email: P.email, password: P.password }),
    headers: { origin: 'https://app.theflyventures.com', 'x-forwarded-for': forwarded },
  });
  check('registration works in production', r.status === 201, `got ${r.status} ${r.body.message}`);
  check(
    'behind the proxy, throttling keys on the real client address (trust proxy)',
    (await redis.get(`register:address:${forwarded}`)) === '1',
  );

  r = await call(PROD, P.jar, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: P.email, password: P.password }),
    headers: { origin: 'https://app.theflyventures.com' },
  });
  const cookie = r.setCookies.find((line) => line.startsWith('ir_session=')) ?? '';
  // Captured now: logout later replaces the jar entry with an empty value.
  const prodSessionIds = P.jar.values().filter((value) => value !== '');
  check('session cookie is HttpOnly', /;\s*HttpOnly/i.test(cookie), cookie.replace(/=[^;]+/, '=<hidden>'));
  check('session cookie is Secure in production', /;\s*Secure/i.test(cookie));
  check('session cookie is SameSite=Lax', /;\s*SameSite=Lax/i.test(cookie));
  check('session cookie is host-only (no Domain attribute)', !/;\s*Domain=/i.test(cookie));
  check('login response carries no password hash', !/passwordHash|scrypt\$/.test(r.raw));

  r = await call(PROD, P.jar, '/api/auth/me');
  check('the session authenticates', r.status === 200);
  await call(PROD, P.jar, '/api/auth/logout', { method: 'POST', headers: { origin: 'https://app.theflyventures.com' } });
  r = await call(PROD, P.jar, '/api/auth/me');
  check('logout invalidates the session in production', r.status === 401);

  const output = prod.output();
  check('production process log holds no password', !output.includes(P.password));
  check(
    'production process log holds no session id',
    prodSessionIds.length > 0 && prodSessionIds.every((value) => !output.includes(value)),
  );
  check('production process log holds no encryption key', !output.includes(smokeKey));
}

prod.child.kill();
await waitExit(prod.child, 5_000);
fs.rmSync(smokeDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
console.log('');
console.log('=== NO SECRETS IN DEVELOPMENT LOGS ===');
if (LOG_DIR === null) {
  console.log('  SKIP  IR_LOG_DIR not set; log scan not run');
} else {
  const apiLog = fs.readFileSync(path.join(LOG_DIR, 'api.log'), 'utf8');
  const workerLog = fs.readFileSync(path.join(LOG_DIR, 'worker.log'), 'utf8');
  const both = `${apiLog}\n${workerLog}`;
  const envText = fs.readFileSync(`${ROOT}/apps/api/.env`, 'utf8');
  const devKey = (envText.match(/^ENCRYPTION_KEY=(.+)$/m)?.[1] ?? '').trim();
  const sessionIds = [...A.jar.values(), ...B.jar.values()].filter((value) => value !== '');

  check('no suite passwords in logs', ![A.password, B.password].some((secret) => both.includes(secret)));
  check('no session ids in logs', sessionIds.length > 0 && sessionIds.every((value) => !both.includes(value)));
  check('no encryption key in logs', devKey !== '' && !both.includes(devKey));
  check('no Google client secret or tokens in logs', !/GOCSPX|ya29\./.test(both));
  const codes = [...apiLog.matchAll(/[?&]code=([^&\s"]+)/g)].map((match) => match[1]);
  check('every logged OAuth code is redacted', codes.every((value) => value === '%5Bredacted%5D'), codes.slice(0, 3).join(','));
  check('no Authorization or Cookie headers in logs', !/authorization:|cookie:|ir_session=/i.test(both));
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== CLEANUP ===');
const users = await db.User.find({ email: { $in: cleanup.users } }).select('_id');
const ownedProjects = await db.Project.find({ userId: { $in: users.map((u) => u._id) } }).select('_id');
const projectIds = ownedProjects.map((p) => p._id);
await db.SubmissionBatchItem.deleteMany({ projectId: { $in: projectIds } });
await db.SubmissionBatch.deleteMany({ projectId: { $in: projectIds } });
await db.Url.deleteMany({ projectId: { $in: projectIds } });
await db.Project.deleteMany({ _id: { $in: projectIds } });
await db.User.deleteMany({ email: { $in: cleanup.users } });
for (const key of cleanup.redisKeys) await redis.del(key);
await queue.closeSubmissionQueue().catch(() => undefined);
await queue.disconnectRedis().catch(() => undefined);
await db.disconnectDatabase();
console.log('  throwaway data removed');

console.log('');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
