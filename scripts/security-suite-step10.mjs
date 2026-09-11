/**
 * Step 10 integration security suite.
 *
 * Runs against the live API and exercises the things that can only be proven
 * end to end: real sessions, real cookies, and the cross-user authorization
 * matrix. Creates two throwaway accounts (A and B), each with their own project
 * and URL, then verifies that neither can reach the other's resources.
 *
 * Usage: node scripts/security-suite-step10.mjs
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

/** Minimal cookie jar so each identity keeps its own session. */
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
    has(name) {
      return jar.has(name) && jar.get(name) !== '';
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
const A = { email: `sec-a-${stamp}@indexrocket.test`, password: 'suite-password-A-1234', jar: makeJar() };
const B = { email: `sec-b-${stamp}@indexrocket.test`, password: 'suite-password-B-1234', jar: makeJar() };

console.log('=== REGISTRATION ===');
let r = await call(null, '/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Suite A', email: A.email, password: A.password }),
});
check('valid registration returns 201', r.status === 201, `got ${r.status}`);
check('registration never returns passwordHash', !r.raw.includes('passwordHash') && !r.raw.includes('scrypt$'));
A.id = r.body?.data?.id;

r = await call(null, '/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Suite B', email: B.email, password: B.password }),
});
B.id = r.body?.data?.id;
check('second account created', r.status === 201, `got ${r.status}`);

r = await call(null, '/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Dup', email: A.email, password: 'another-password-1234' }),
});
check('duplicate email rejected (409)', r.status === 409, `got ${r.status}`);

r = await call(null, '/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Bad', email: 'not-an-email', password: 'another-password-1234' }),
});
check('invalid email rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(null, '/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name: 'Weak', email: `weak-${stamp}@indexrocket.test`, password: 'short' }),
});
check('weak password rejected (400)', r.status === 400, `got ${r.status}`);

r = await call(null, '/api/auth/register', { method: 'POST', body: JSON.stringify({ junk: true }) });
check('malformed body rejected (400)', r.status === 400, `got ${r.status}`);

console.log('');
console.log('=== LOGIN / SESSION ===');
r = await call(A.jar, '/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: A.email, password: A.password }),
});
check('valid login returns 200', r.status === 200, `got ${r.status}`);
check('login sets a session cookie', A.jar.has('ir_session'));
check('login response has no passwordHash', !r.raw.includes('passwordHash') && !r.raw.includes('scrypt$'));

await call(B.jar, '/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: B.email, password: B.password }),
});
check('second identity signed in', B.jar.has('ir_session'));

r = await call(null, '/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: A.email, password: 'wrong-password-value' }),
});
check('wrong password rejected (401)', r.status === 401, `got ${r.status}`);
const wrongPasswordMessage = r.body?.message;

r = await call(null, '/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: `nobody-${stamp}@indexrocket.test`, password: 'wrong-password-value' }),
});
check('unknown account rejected (401)', r.status === 401, `got ${r.status}`);
check(
  'identical message for unknown account and wrong password (no enumeration)',
  r.body?.message === wrongPasswordMessage,
  `${r.body?.message} vs ${wrongPasswordMessage}`,
);

console.log('');
console.log('=== AUTHENTICATION ENFORCEMENT ===');
r = await call(null, '/api/auth/me');
check('unauthenticated /me rejected (401)', r.status === 401, `got ${r.status}`);

r = await call(A.jar, '/api/auth/me');
check('authenticated /me accepted (200)', r.status === 200, `got ${r.status}`);
check('/me returns the right account', r.body?.data?.email === A.email);

for (const path of ['/api/google/connection', '/api/google/search-console/properties', '/api/urls/inspect']) {
  const res = await call(null, path, path.endsWith('inspect') ? { method: 'POST', body: '{}' } : {});
  check(`unauthenticated ${path} rejected`, res.status === 401, `got ${res.status}`);
}

console.log('');
console.log('=== x-user-id SPOOFING ===');
r = await call(null, '/api/auth/me', { headers: { 'x-user-id': A.id } });
check('x-user-id alone does not authenticate', r.status === 401, `got ${r.status}`);

r = await call(A.jar, '/api/auth/me', { headers: { 'x-user-id': B.id } });
check(
  'x-user-id cannot override the session identity',
  r.status === 200 && r.body?.data?.email === A.email,
  `got ${r.status} ${r.body?.data?.email}`,
);

console.log('');
console.log('=== CROSS-USER AUTHORIZATION ===');
await db.connectDatabase({ uri: mongoUri });

const projectA = await db.Project.create({ userId: A.id, name: 'Suite A project', domain: 'example.com' });
const projectB = await db.Project.create({ userId: B.id, name: 'Suite B project', domain: 'example.com' });
const urlB = await db.Url.create({
  projectId: projectB._id,
  url: `https://example.com/b-${stamp}`,
  status: 'inspected',
  httpStatus: 200,
});
await db.GoogleConnection.deleteMany({ userId: B.id });

r = await call(A.jar, '/api/urls/inspect', {
  method: 'POST',
  body: JSON.stringify({ projectId: String(projectB._id), url: 'https://example.com/steal' }),
});
check("A cannot submit a URL into B's project (404)", r.status === 404, `got ${r.status} ${r.body?.message}`);

r = await call(A.jar, `/api/urls/${urlB._id}`);
check("A cannot read B's URL (404)", r.status === 404, `got ${r.status}`);

r = await call(A.jar, `/api/urls/${urlB._id}/discover`);
check("A cannot trigger discovery on B's URL", r.status === 404, `got ${r.status}`, );

r = await call(B.jar, `/api/urls/${urlB._id}`);
check('B can read their own URL (200)', r.status === 200, `got ${r.status}`);

r = await call(A.jar, '/api/urls/inspect', {
  method: 'POST',
  body: JSON.stringify({ projectId: String(projectA._id), url: 'https://example.com/mine' }),
});
check('A can submit into their own project (202)', r.status === 202, `got ${r.status} ${r.body?.message}`);

r = await call(B.jar, '/api/google/search-console/properties');
check(
  "B has no Google connection, so cannot use A's (409)",
  r.status === 409,
  `got ${r.status} ${r.body?.message}`,
);

r = await call(B.jar, '/api/google/connection');
check(
  "B's connection status is their own (not connected)",
  r.status === 200 && r.body?.data?.connected === false,
  JSON.stringify(r.body?.data),
);

console.log('');
console.log('=== SECRET NON-DISCLOSURE ===');
r = await call(A.jar, '/api/auth/me');
check('no passwordHash in /me', !r.raw.includes('passwordHash') && !r.raw.includes('scrypt$'));

r = await call(B.jar, '/api/google/connection');
check(
  'no OAuth tokens in connection response',
  !/accessToken|refreshToken|ya29\.|client_secret/i.test(r.raw),
  r.raw.slice(0, 120),
);

console.log('');
console.log('=== LOGOUT INVALIDATION ===');
r = await call(A.jar, '/api/auth/me');
check('session valid before logout', r.status === 200, `got ${r.status}`);

const capturedCookie = A.jar.header();
r = await call(A.jar, '/api/auth/logout', { method: 'POST' });
check('logout returns 200', r.status === 200, `got ${r.status}`);

r = await call(A.jar, '/api/auth/me');
check('session rejected after logout (401)', r.status === 401, `got ${r.status}`);

// Replay the exact pre-logout cookie: the server-side record must be gone.
const replay = await fetch(`${API}/api/auth/me`, { headers: { cookie: capturedCookie } });
check('captured pre-logout cookie is dead (401)', replay.status === 401, `got ${replay.status}`);

console.log('');
console.log('=== CLEANUP ===');
await db.Url.deleteMany({ projectId: { $in: [projectA._id, projectB._id] } });
await db.Project.deleteMany({ _id: { $in: [projectA._id, projectB._id] } });
await db.User.deleteMany({ email: { $in: [A.email, B.email, `weak-${stamp}@indexrocket.test`] } });
await db.disconnectDatabase();
console.log('  throwaway accounts and projects removed');

console.log('');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
