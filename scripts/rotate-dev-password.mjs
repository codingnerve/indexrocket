/**
 * Rotates an account password to a locally generated random value.
 *
 * The new password is created with crypto.randomBytes, written once to a
 * gitignored file with owner-only permissions, and never printed to stdout.
 * Neither the old nor the new password is logged.
 *
 * Usage: node scripts/rotate-dev-password.mjs --email <account email>
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const db = await import('file:///C:/Project/indexrocket/packages/database/dist/index.js');
const utils = await import('file:///C:/Project/indexrocket/packages/utils/dist/index.js');
const queue = await import('file:///C:/Project/indexrocket/packages/queue/dist/index.js');
const sessions = await import(
  'file:///C:/Project/indexrocket/apps/api/dist/services/auth/sessionStore.js'
);

const API = process.env.API_URL ?? 'http://localhost:5000';
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/indexrocket';
const OUT = 'C:/Project/indexrocket/.dev-password.txt';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** Live login attempt. Returns only the status code; the body is discarded. */
async function loginStatus(email, password) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  await response.text();

  return response.status;
}

const emailArg = arg('email');

if (emailArg === null) {
  console.error('Missing --email.');
  process.exit(1);
}

const email = utils.normalizeEmail(emailArg);

await db.connectDatabase({ uri: mongoUri });
await queue.connectRedis({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });

const user = await db.User.findOne({ email }).select('+passwordHash');

if (user === null) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}

const oldHash = String(user.passwordHash ?? '');

// 32 random bytes, base64url encoded: ~43 characters of unguessable secret.
const newPassword = randomBytes(32).toString('base64url');

const policy = utils.checkPasswordPolicy(newPassword);

if (!policy.valid) {
  console.error(`Generated password failed the policy: ${policy.reason}`);
  process.exit(1);
}

// --- apply ------------------------------------------------------------------
user.passwordHash = await utils.hashPassword(newPassword);
await user.save();

const revoked = await sessions.destroyAllSessionsForUser(String(user._id));

// Handed over through a gitignored, owner-only file rather than stdout.
fs.writeFileSync(OUT, `${newPassword}\n`, { mode: 0o600 });
fs.chmodSync(OUT, 0o600);

// --- verify -----------------------------------------------------------------
const freshHash = String((await db.User.findById(user._id).select('+passwordHash')).passwordHash);

const changed = freshHash !== oldHash && freshHash.startsWith('scrypt$');
const newVerifies = await utils.verifyPassword(newPassword, freshHash);
const newDoesNotMatchOldHash = !(await utils.verifyPassword(newPassword, oldHash));
const oldHashGone = (await db.User.countDocuments({ email, passwordHash: oldHash })) === 0;

const liveNew = await loginStatus(email, newPassword);
// Control: an arbitrary non-matching password must be rejected by the same route.
const liveWrong = await loginStatus(email, randomBytes(24).toString('base64url'));

console.log('checks:');
console.log(`  storedHashChanged=${changed}`);
console.log(`  oldHashNoLongerStored=${oldHashGone}`);
console.log(`  newPasswordVerifies=${newVerifies}`);
console.log(`  newPasswordDoesNotMatchOldHash=${newDoesNotMatchOldHash}`);
console.log(`  sessionsInvalidated=${revoked}`);
console.log(`  liveLoginNewPassword=${liveNew}`);
console.log(`  liveLoginNonMatchingPassword=${liveWrong}`);
console.log(`  credentialFile=${path.resolve(OUT)}`);

await queue.disconnectRedis().catch(() => undefined);
await db.disconnectDatabase();
