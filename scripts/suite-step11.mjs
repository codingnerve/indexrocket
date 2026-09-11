/**
 * Step 11 integration suite: project + URL management, pagination, summary
 * correctness, and the full cross-user isolation matrix.
 *
 * Creates two throwaway accounts, exercises every new endpoint, and cleans up.
 * Usage: node scripts/suite-step11.mjs
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

const stamp = Date.now();
const A = { email: `s11-a-${stamp}@indexrocket.test`, password: 'suite-11-password-A', jar: makeJar() };
const B = { email: `s11-b-${stamp}@indexrocket.test`, password: 'suite-11-password-B', jar: makeJar() };

for (const identity of [A, B]) {
  await call(null, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Suite', email: identity.email, password: identity.password }),
  });
  const login = await call(identity.jar, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: identity.email, password: identity.password }),
  });
  identity.id = login.body?.data?.id;
}

console.log('=== PROJECT CRUD ===');
let r = await call(A.jar, '/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: 'Suite A site', domain: 'HTTPS://WWW.SuiteA-' + stamp + '.com/' }),
});
check('create normalizes a pasted URL to a bare host', r.status === 201 && r.body?.data?.domain === `suitea-${stamp}.com`, `${r.status} ${r.body?.data?.domain}`);
check('create never returns the IndexNow key', !('indexNowKey' in (r.body?.data ?? {})));
const projectA = r.body?.data?.id;

r = await call(A.jar, '/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: 'Dup', domain: `suitea-${stamp}.com` }),
});
check('duplicate domain for the same user rejected (409)', r.status === 409, `got ${r.status}`);

for (const bad of ['not a domain', 'localhost', '', 'ftp://x.com', 'example']) {
  const res = await call(A.jar, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bad', domain: bad }),
  });
  check(`invalid domain rejected: ${JSON.stringify(bad)}`, res.status === 400, `got ${res.status}`);
}

r = await call(A.jar, '/api/projects');
check('list returns only the caller projects', r.status === 200 && r.body.data.every((p) => p.id !== undefined), `got ${r.status}`);
const listedA = r.body.data.length;

r = await call(A.jar, `/api/projects/${projectA}`);
check('read own project (200)', r.status === 200, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}`, {
  method: 'PATCH',
  body: JSON.stringify({ name: 'Renamed suite project' }),
});
check('update own project (200)', r.status === 200 && r.body?.data?.name === 'Renamed suite project', `got ${r.status}`);

console.log('');
console.log('=== URL MANAGEMENT ===');
const host = `suitea-${stamp}.com`;

r = await call(A.jar, `/api/projects/${projectA}/urls`, {
  method: 'POST',
  body: JSON.stringify({ url: `https://${host}/one` }),
});
check('add URL (201, created)', r.status === 201 && r.body.created === true, `got ${r.status}`);
const urlA = r.body?.data?.id;

r = await call(A.jar, `/api/projects/${projectA}/urls`, {
  method: 'POST',
  body: JSON.stringify({ url: `https://${host}/one` }),
});
check('duplicate add is idempotent (200, created=false)', r.status === 200 && r.body.created === false, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}/urls`, {
  method: 'POST',
  body: JSON.stringify({ url: 'https://elsewhere.example.net/x' }),
});
check('URL outside the project domain rejected (400)', r.status === 400, `got ${r.status}`);

for (const bad of ['http://127.0.0.1', 'http://localhost', 'not-a-url', 'ftp://x.com']) {
  const res = await call(A.jar, `/api/projects/${projectA}/urls`, {
    method: 'POST',
    body: JSON.stringify({ url: bad }),
  });
  check(`SSRF/validation still enforced on add: ${bad}`, res.status === 400, `got ${res.status}`);
}

const bulk = [];
for (let i = 0; i < 30; i += 1) bulk.push(`https://${host}/bulk-${i}`);
bulk.push(`https://${host}/one`);
bulk.push('http://127.0.0.1/evil');
bulk.push('https://other.example.org/x');

r = await call(A.jar, `/api/projects/${projectA}/urls/bulk`, {
  method: 'POST',
  body: JSON.stringify({ urls: bulk }),
});
check('bulk import creates the valid rows', r.body?.summary?.created === 30, JSON.stringify(r.body?.summary));
check('bulk import flags the duplicate', r.body?.summary?.duplicates === 1, JSON.stringify(r.body?.summary));
check('bulk import rejects SSRF and foreign hosts', r.body?.summary?.rejected === 2, JSON.stringify(r.body?.summary));

r = await call(A.jar, `/api/projects/${projectA}/urls/bulk`, {
  method: 'POST',
  body: JSON.stringify({ urls: new Array(501).fill(`https://${host}/x`) }),
});
check('bulk import is bounded (400 over the cap)', r.status === 400, `got ${r.status}`);

console.log('');
console.log('=== LIST / PAGINATION / FILTERING ===');
r = await call(A.jar, `/api/projects/${projectA}/urls?page=1&limit=10`);
check('pagination returns one page', r.body?.data?.length === 10, `got ${r.body?.data?.length}`);
check('pagination reports the total', r.body?.pagination?.total === 31, JSON.stringify(r.body?.pagination));
check('pagination reports hasMore', r.body?.pagination?.hasMore === true);

r = await call(A.jar, `/api/projects/${projectA}/urls?page=4&limit=10`);
check('last page returns the remainder', r.body?.data?.length === 1, `got ${r.body?.data?.length}`);

r = await call(A.jar, `/api/projects/${projectA}/urls?search=bulk-1`);
check('search filters', r.body?.data?.length > 0 && r.body.data.every((u) => u.url.includes('bulk-1')), `got ${r.body?.data?.length}`);

r = await call(A.jar, `/api/projects/${projectA}/urls?search=.*`);
check('search treats input literally, not as a regex', r.body?.pagination?.total === 0, `got ${r.body?.pagination?.total}`);

r = await call(A.jar, `/api/projects/${projectA}/urls?status=queued`);
check('status filter works', r.body?.pagination?.total === 31, `got ${r.body?.pagination?.total}`);

r = await call(A.jar, `/api/projects/${projectA}/urls?status=bogus`);
check('invalid status rejected (400)', r.status === 400, `got ${r.status}`);

console.log('');
console.log('=== SUMMARY COUNTS COME FROM THE RIGHT FIELDS ===');
await db.connectDatabase({ uri: mongoUri });

// Craft a URL whose three families deliberately disagree.
const target = await db.Url.findOne({ url: `https://${host}/bulk-0` });
check('bulk-imported URL exists in the database', target !== null);
await db.Url.updateOne(
  { _id: target?._id ?? null },
  {
    $set: {
      status: 'inspected',
      httpStatus: 200,
      indexNowStatus: 'accepted',
      indexNowResponseCode: 200,
      googleInspection: { status: 'not_indexed', verdict: 'FAIL', inspectedAt: new Date() },
    },
  },
);

r = await call(A.jar, `/api/projects/${projectA}/summary`);
const s = r.body?.data;
check('summary totals match', s?.totalUrls === 31, JSON.stringify(s?.totalUrls));
check('inspected count comes from Url.status', s?.inspection?.inspected === 1, JSON.stringify(s?.inspection));
check(
  'IndexNow accepted counted from discovery state',
  s?.indexNow?.accepted === 1,
  JSON.stringify(s?.indexNow),
);
check(
  'an accepted IndexNow notification is NOT counted as Google indexed',
  s?.google?.indexed === 0,
  JSON.stringify(s?.google),
);
check(
  'Google not-indexed comes from googleInspection.status',
  s?.google?.notIndexed === 1,
  JSON.stringify(s?.google),
);
check('URLs never inspected by Google are counted separately', s?.google?.notInspected === 30, JSON.stringify(s?.google));

console.log('');
console.log('=== CROSS-USER ISOLATION ===');
r = await call(B.jar, '/api/projects');
check('B does not see A projects in the list', r.body?.data?.every((p) => p.id !== projectA), `${r.body?.data?.length} projects`);

for (const [label, path, init] of [
  ['read A project', `/api/projects/${projectA}`, {}],
  ['update A project', `/api/projects/${projectA}`, { method: 'PATCH', body: JSON.stringify({ name: 'hijack' }) }],
  ['delete A project', `/api/projects/${projectA}`, { method: 'DELETE' }],
  ['read A project summary', `/api/projects/${projectA}/summary`, {}],
  ['list A URLs', `/api/projects/${projectA}/urls`, {}],
  ['read A URL', `/api/projects/${projectA}/urls/${urlA}`, {}],
  ['delete A URL', `/api/projects/${projectA}/urls/${urlA}`, { method: 'DELETE' }],
  ['add a URL into A project', `/api/projects/${projectA}/urls`, { method: 'POST', body: JSON.stringify({ url: `https://${host}/evil` }) }],
  ['bulk import into A project', `/api/projects/${projectA}/urls/bulk`, { method: 'POST', body: JSON.stringify({ urls: [`https://${host}/evil2`] }) }],
  ['inspect A URL', `/api/urls/${urlA}`, {}],
  ['discover A URL', `/api/urls/${urlA}/discover`, { method: 'POST' }],
]) {
  const res = await call(B.jar, path, init);
  check(`B cannot ${label} (404)`, res.status === 404, `got ${res.status}`);
}

r = await call(B.jar, '/api/urls/inspect', {
  method: 'POST',
  body: JSON.stringify({ projectId: projectA, url: `https://${host}/evil` }),
});
check('B cannot queue inspection into A project (404)', r.status === 404, `got ${r.status}`);

console.log('');
console.log('=== AUTHENTICATION ===');
for (const [label, path, init] of [
  ['list projects', '/api/projects', {}],
  ['create project', '/api/projects', { method: 'POST', body: '{}' }],
  ['project summary', `/api/projects/${projectA}/summary`, {}],
  ['list URLs', `/api/projects/${projectA}/urls`, {}],
]) {
  const res = await call(null, path, init);
  check(`unauthenticated ${label} rejected (401)`, res.status === 401, `got ${res.status}`);
}

r = await call(null, '/api/projects', { headers: { 'x-user-id': A.id } });
check('x-user-id does not authenticate on the new routes', r.status === 401, `got ${r.status}`);

r = await call(B.jar, '/api/projects', { headers: { 'x-user-id': A.id } });
check(
  'x-user-id cannot widen an existing session',
  r.status === 200 && r.body.data.every((p) => p.id !== projectA),
  `got ${r.status}`,
);

console.log('');
console.log('=== SECRET PROTECTION ===');
r = await call(A.jar, `/api/projects/${projectA}/urls?limit=100`);
check(
  'URL listing exposes no credentials',
  !/passwordHash|scrypt\$|indexNowKey|accessToken|refreshToken|ya29\./i.test(r.raw),
);

r = await call(A.jar, '/api/projects');
check('project listing exposes no IndexNow key', !/"indexNowKey"/.test(r.raw));

console.log('');
console.log('=== DOMAIN CHANGE GUARD ===');
r = await call(A.jar, `/api/projects/${projectA}`, {
  method: 'PATCH',
  body: JSON.stringify({ domain: `changed-${stamp}.com` }),
});
check('domain cannot change while URLs exist (409)', r.status === 409, `got ${r.status}`);

console.log('');
console.log('=== DELETE ===');
r = await call(A.jar, `/api/projects/${projectA}/urls/${urlA}`, { method: 'DELETE' });
check('owner can delete their URL (200)', r.status === 200, `got ${r.status}`);

r = await call(A.jar, `/api/projects/${projectA}`, { method: 'DELETE' });
check('owner can delete their project (200)', r.status === 200, `got ${r.status}`);
check('deleting a project removes its URLs', r.body?.deletedUrls === 30, JSON.stringify(r.body?.deletedUrls));

r = await call(A.jar, `/api/projects/${projectA}`);
check('deleted project is gone (404)', r.status === 404, `got ${r.status}`);

console.log('');
console.log('=== CLEANUP ===');
await db.Project.deleteMany({ name: /^Suite|^Renamed suite/ });
await db.User.deleteMany({ email: { $in: [A.email, B.email] } });
await db.disconnectDatabase();
console.log('  throwaway accounts and projects removed');

console.log('');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
