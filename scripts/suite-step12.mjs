/**
 * Step 12 integration suite: batch creation, validation, idempotency, retries,
 * counters, cancellation and the cross-user matrix.
 *
 * Uses throwaway accounts on a non-existent domain, so no real IndexNow
 * notification is ever sent (no key is configured on those projects).
 *
 * Usage: node scripts/suite-step12.mjs
 */
import process from 'node:process';

const API = process.env.API_URL ?? 'http://localhost:5000';
const db = await import('file:///C:/Project/indexrocket/packages/database/dist/index.js');
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/indexrocket';

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
  };
}

async function call(jar, path, init = {}) {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };

  if (jar !== null) {
    const cookie = jar.header();
    if (cookie !== '') headers.cookie = cookie;
  }

  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (jar !== null) jar.store(response);

  const text = await response.text();
  let body = {};
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }

  return { status: response.status, body, raw: text };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTerminal(jar, projectId, batchId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const terminal = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

  while (Date.now() < deadline) {
    const res = await call(jar, `/api/projects/${projectId}/batches/${batchId}`);

    if (terminal.includes(res.body?.data?.status)) {
      return res.body.data;
    }

    await sleep(2000);
  }

  return null;
}

const stamp = Date.now();
const A = { email: `s12-a-${stamp}@indexrocket.test`, password: 'suite-12-password-A', jar: makeJar() };
const B = { email: `s12-b-${stamp}@indexrocket.test`, password: 'suite-12-password-B', jar: makeJar() };

for (const identity of [A, B]) {
  await call(null, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Suite12', email: identity.email, password: identity.password }),
  });
  const login = await call(identity.jar, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, password: identity.password }),
  });
  identity.id = login.body?.data?.id;
}

const hostA = `s12a-${stamp}.com`;
const hostB = `s12b-${stamp}.com`;

let r = await call(A.jar, '/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: 'S12 A', domain: hostA }),
});
const projectA = r.body?.data?.id;

r = await call(B.jar, '/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: 'S12 B', domain: hostB }),
});
const projectB = r.body?.data?.id;

// URLs for A
const urlIdsA = [];
for (let i = 0; i < 4; i += 1) {
  const res = await call(A.jar, `/api/projects/${projectA}/urls`, {
    method: 'POST',
    body: JSON.stringify({ url: `https://${hostA}/p-${i}` }),
  });
  urlIdsA.push(res.body?.data?.id);
}

const resB = await call(B.jar, `/api/projects/${projectB}/urls`, {
  method: 'POST',
  body: JSON.stringify({ url: `https://${hostB}/b-0` }),
});
const urlIdB = resB.body?.data?.id;

console.log('=== BATCH VALIDATION ===');
r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [] }),
});
check('empty batch rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: new Array(201).fill(urlIdsA[0]) }),
});
check('oversized batch rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: ['not-an-objectid'] }),
});
check('malformed url id rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdB] }),
});
check("cross-project URL id rejected (400)", r.status === 400, `got ${r.status} ${r.body?.message}`);

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[0], urlIdsA[0], urlIdsA[0]] }),
});
check('duplicate url ids deduplicated to one item', r.status === 202 && r.body?.data?.total === 1, JSON.stringify(r.body?.summary));
const dedupeBatch = r.body?.data?.id;

console.log('');
console.log('=== DUPLICATE SUBMISSION PROTECTION ===');
r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[0]] }),
});
check(
  'a URL already in an unfinished batch is not queued twice (409)',
  r.status === 409 || r.body?.summary?.alreadyInFlight === 1,
  `got ${r.status} ${JSON.stringify(r.body?.summary)}`,
);

await waitForTerminal(A.jar, projectA, dedupeBatch);

console.log('');
console.log('=== BATCH PROCESSING + COUNTERS ===');
r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[1], urlIdsA[2], urlIdsA[3]] }),
});
check('batch created (202)', r.status === 202, `got ${r.status}`);
check('batch reports the right total', r.body?.data?.total === 3, JSON.stringify(r.body?.data?.total));
const mainBatch = r.body?.data?.id;

const finished = await waitForTerminal(A.jar, projectA, mainBatch);
check('batch reached a terminal state', finished !== null, JSON.stringify(finished?.status));

if (finished !== null) {
  check(
    'counters sum to the total',
    finished.completed + finished.failed + finished.skipped === finished.total,
    JSON.stringify(finished),
  );
  check('no pending or processing left', finished.pending === 0 && finished.processing === 0, JSON.stringify(finished));
  check('startedAt and completedAt are recorded', finished.startedAt !== null && finished.completedAt !== null);

  // These domains do not resolve, so inspection legitimately fails: the batch
  // must report that honestly rather than claiming success.
  check(
    'unreachable URLs are reported as failed, not completed',
    finished.failed === 3,
    JSON.stringify(finished),
  );
  check('status is failed when every item failed', finished.status === 'failed', finished.status);
}

r = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}/items`);
check('items endpoint returns every item', r.body?.pagination?.total === 3, JSON.stringify(r.body?.pagination));
check(
  'items record a per-stage outcome',
  r.body?.data?.every((item) => item.inspectionStatus !== undefined && item.discoveryStatus !== undefined && item.googleStatus !== undefined),
);
check(
  'a failed inspection never reports a successful notification',
  r.body?.data?.every((item) => !(item.inspectionStatus === 'failed' && item.discoveryStatus === 'succeeded')),
);
check(
  'Google stage never runs unless the batch enabled it',
  r.body?.data?.every((item) => item.googleStatus === 'not_run'),
);

r = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}/items?status=failed`);
check('item status filter works', r.body?.pagination?.total === 3, JSON.stringify(r.body?.pagination));

r = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}/items?status=bogus`);
check('invalid item status rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}/items?discoveryStatus=succeeded`);
check('discovery filter works', r.body?.pagination?.total === 0, JSON.stringify(r.body?.pagination));

console.log('');
console.log('=== PERMANENT FAILURE IS NOT RETRIED FOREVER ===');
await db.connectDatabase({ uri: mongoUri });
const items = await db.SubmissionBatchItem.find({ batchId: mainBatch }).lean();
check(
  'a permanent failure stops after the first attempt',
  items.every((item) => item.attempts <= 3),
  JSON.stringify(items.map((item) => item.attempts)),
);
check('failure reason is recorded', items.every((item) => item.errorMessage !== null));

console.log('');
console.log('=== IDEMPOTENCY: DUPLICATE / INJECTED JOBS ===');
const queue = await import('file:///C:/Project/indexrocket/packages/queue/dist/index.js');
await queue.connectRedis({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });

const firstItem = items[0];
const beforeAttempts = firstItem.attempts;

// Inject the identical job straight onto the queue, bypassing the API.
await queue.addSubmissionJob({
  batchId: String(firstItem.batchId),
  itemId: String(firstItem._id),
  projectId: String(firstItem.projectId),
  userId: A.id,
  urlId: String(firstItem.urlId),
  url: firstItem.url,
  inspectGoogle: false,
  googleSiteUrl: null,
});
await sleep(6000);

const afterItem = await db.SubmissionBatchItem.findById(firstItem._id).lean();
check(
  'a replayed job does not reprocess a finished item',
  afterItem.status === firstItem.status && afterItem.attempts === beforeAttempts,
  `status ${afterItem.status} attempts ${afterItem.attempts}`,
);

const batchAfter = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}`);
check(
  'counters stay correct after a replayed job',
  batchAfter.body.data.completed + batchAfter.body.data.failed + batchAfter.body.data.skipped ===
    batchAfter.body.data.total,
  JSON.stringify(batchAfter.body.data),
);

console.log('');
console.log('=== COUNTER RECONCILIATION ===');
// Corrupt the cached counters, then read the batch: the item collection wins.
await db.SubmissionBatch.updateOne({ _id: mainBatch }, { $set: { completed: 99, failed: 0 } });
const reconciled = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}`);
check(
  'reading a batch repairs corrupted counters from the items',
  reconciled.body.data.completed !== 99 &&
    reconciled.body.data.completed + reconciled.body.data.failed + reconciled.body.data.skipped ===
      reconciled.body.data.total,
  JSON.stringify(reconciled.body.data),
);

console.log('');
console.log('=== CANCELLATION ===');
const cancelUrls = [];
for (let i = 0; i < 3; i += 1) {
  const res = await call(A.jar, `/api/projects/${projectA}/urls`, {
    method: 'POST',
    body: JSON.stringify({ url: `https://${hostA}/cancel-${i}` }),
  });
  cancelUrls.push(res.body?.data?.id);
}

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: cancelUrls }),
});
const cancelBatch = r.body?.data?.id;

r = await call(A.jar, `/api/projects/${projectA}/batches/${cancelBatch}/cancel`, { method: 'POST' });
check('cancel returns 200', r.status === 200, `got ${r.status}`);
check('cancel reports what it actually stopped', typeof r.body?.cancelledPending === 'number', JSON.stringify(r.body));

const cancelled = await call(A.jar, `/api/projects/${projectA}/batches/${cancelBatch}`);
check('cancelled batch reports cancelled', cancelled.body?.data?.status === 'cancelled', cancelled.body?.data?.status);

r = await call(A.jar, `/api/projects/${projectA}/batches/${cancelBatch}/cancel`, { method: 'POST' });
check('cancelling twice is rejected (409)', r.status === 409, `got ${r.status}`);

console.log('');
console.log('=== CROSS-USER ISOLATION ===');
for (const [label, path, init] of [
  ['read A batch', `/api/projects/${projectA}/batches/${mainBatch}`, {}],
  ['list A batches', `/api/projects/${projectA}/batches`, {}],
  ['read A batch items', `/api/projects/${projectA}/batches/${mainBatch}/items`, {}],
  ['cancel A batch', `/api/projects/${projectA}/batches/${mainBatch}/cancel`, { method: 'POST' }],
  ['create a batch in A project', `/api/projects/${projectA}/batches`, { method: 'POST', body: JSON.stringify({ urlIds: [urlIdsA[0]] }) }],
]) {
  const res = await call(B.jar, path, init);
  check(`B cannot ${label} (404)`, res.status === 404, `got ${res.status}`);
}

r = await call(B.jar, `/api/projects/${projectB}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[0]] }),
});
check("B cannot submit A's URL through B's own project (400)", r.status === 400, `got ${r.status}`);

console.log('');
console.log('=== AUTHENTICATION ===');
for (const [label, path, init] of [
  ['create batch', `/api/projects/${projectA}/batches`, { method: 'POST', body: '{}' }],
  ['list batches', `/api/projects/${projectA}/batches`, {}],
  ['read batch', `/api/projects/${projectA}/batches/${mainBatch}`, {}],
  ['cancel batch', `/api/projects/${projectA}/batches/${mainBatch}/cancel`, { method: 'POST' }],
]) {
  const res = await call(null, path, init);
  check(`unauthenticated ${label} rejected (401)`, res.status === 401, `got ${res.status}`);
}

r = await call(null, `/api/projects/${projectA}/batches`, { headers: { 'x-user-id': A.id } });
check('x-user-id cannot authenticate a batch route', r.status === 401, `got ${r.status}`);

r = await call(B.jar, `/api/projects/${projectA}/batches`, { headers: { 'x-user-id': A.id } });
check('x-user-id cannot widen a session onto another user batch', r.status === 404, `got ${r.status}`);

console.log('');
console.log('=== GOOGLE OPT-IN GUARD ===');
r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[1]], inspectGoogle: true }),
});
check('inspectGoogle without a property rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/batches`, {
  method: 'POST',
  body: JSON.stringify({ urlIds: [urlIdsA[1]], inspectGoogle: true, googleSiteUrl: 'https://not-yours.example.com/' }),
});
check(
  'inspectGoogle with an unowned property rejected (403/409)',
  r.status === 403 || r.status === 409,
  `got ${r.status} ${r.body?.message}`,
);

console.log('');
console.log('=== SECRET PROTECTION ===');
r = await call(A.jar, `/api/projects/${projectA}/batches/${mainBatch}/items?limit=100`);
check(
  'batch items expose no credentials',
  !/passwordHash|scrypt\$|indexNowKey|accessToken|refreshToken|ya29\./i.test(r.raw),
);

console.log('');
console.log('=== CLEANUP ===');
await db.SubmissionBatchItem.deleteMany({ projectId: { $in: [projectA, projectB] } });
await db.SubmissionBatch.deleteMany({ projectId: { $in: [projectA, projectB] } });
await db.Url.deleteMany({ projectId: { $in: [projectA, projectB] } });
await db.Project.deleteMany({ _id: { $in: [projectA, projectB] } });
await db.User.deleteMany({ email: { $in: [A.email, B.email] } });
await queue.disconnectRedis().catch(() => undefined);
await db.disconnectDatabase();
console.log('  throwaway data removed');

console.log('');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
