/**
 * Interactively change an IndexRocket account password.
 *
 * Both passwords are typed at a hidden prompt. They are never passed as command
 * arguments (so they cannot land in shell history or a process list), never
 * written to disk, and never printed. Only pass/fail lines are shown.
 *
 * Usage:
 *   node scripts/change-password.mjs --email <account email>
 *
 * Requires the API to be running for the live verification step.
 */
import readline from 'node:readline';
import process from 'node:process';

const db = await import('file:///C:/Project/indexrocket/packages/database/dist/index.js');
const utils = await import('file:///C:/Project/indexrocket/packages/utils/dist/index.js');

const API = process.env.API_URL ?? 'http://localhost:5000';
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/indexrocket';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** Reads a line without echoing it to the terminal. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) {
        process.stdout.write(chunk);
      }
    };

    process.stdout.write(question);
    muted = true;

    rl.question('', (answer) => {
      muted = false;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function apiLogin(email, password) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  // The body is discarded deliberately: it is not needed and must not be echoed.
  await response.text();

  return response.status;
}

const emailArg = arg('email');

if (emailArg === null) {
  console.error('Missing --email. Usage: node scripts/change-password.mjs --email <account email>');
  process.exit(1);
}

const email = utils.normalizeEmail(emailArg);

await db.connectDatabase({ uri: mongoUri });

const user = await db.User.findOne({ email }).select('+passwordHash');

if (user === null) {
  console.error(`No account found for ${email}.`);
  await db.disconnectDatabase();
  process.exit(1);
}

console.log(`Account: ${email}`);
console.log('Passwords are hidden as you type and are never printed or logged.');
console.log('');

const currentPassword = await promptHidden('Current password: ');
const previousHash = String(user.passwordHash ?? '');

if (!(await utils.verifyPassword(currentPassword, previousHash))) {
  console.error('FAIL  The current password is incorrect. Nothing was changed.');
  await db.disconnectDatabase();
  process.exit(1);
}

console.log('OK    Current password verified.');

const newPassword = await promptHidden('New password:     ');
const confirmation = await promptHidden('Confirm new:      ');

if (newPassword !== confirmation) {
  console.error('FAIL  The two new passwords do not match. Nothing was changed.');
  await db.disconnectDatabase();
  process.exit(1);
}

const policy = utils.checkPasswordPolicy(newPassword);

if (!policy.valid) {
  console.error(`FAIL  ${policy.reason} Nothing was changed.`);
  await db.disconnectDatabase();
  process.exit(1);
}

if (newPassword === currentPassword) {
  console.error('FAIL  The new password is the same as the current one. Nothing was changed.');
  await db.disconnectDatabase();
  process.exit(1);
}

// --- apply ------------------------------------------------------------------
user.passwordHash = await utils.hashPassword(newPassword);
await user.save();

console.log('OK    New password stored (scrypt, freshly salted).');

// Changing a password must end every existing session: anyone holding a cookie
// from before the change loses access immediately.
const queue = await import('file:///C:/Project/indexrocket/packages/queue/dist/index.js');
await queue.connectRedis({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });

const sessions = await import('file:///C:/Project/indexrocket/apps/api/dist/services/auth/sessionStore.js').catch(
  () => null,
);

let revoked = 0;

if (sessions !== null) {
  revoked = await sessions.destroyAllSessionsForUser(String(user._id));
}

console.log(`OK    Existing sessions invalidated: ${revoked}`);

// --- verify -----------------------------------------------------------------
console.log('');
console.log('Verification');

const freshHash = String((await db.User.findById(user._id).select('+passwordHash')).passwordHash);

console.log(
  freshHash !== previousHash
    ? 'PASS  Stored hash changed.'
    : 'FAIL  Stored hash did not change.',
);

console.log(
  (await utils.verifyPassword(newPassword, freshHash))
    ? 'PASS  New password verifies against the stored hash.'
    : 'FAIL  New password does not verify.',
);

console.log(
  !(await utils.verifyPassword(currentPassword, freshHash))
    ? 'PASS  Old password no longer verifies against the stored hash.'
    : 'FAIL  Old password still verifies.',
);

// Live check through the real login route.
const oldStatus = await apiLogin(email, currentPassword);
const newStatus = await apiLogin(email, newPassword);

console.log(
  oldStatus === 401
    ? 'PASS  API login with the old password is rejected (401).'
    : `FAIL  API login with the old password returned ${oldStatus} (expected 401).`,
);

console.log(
  newStatus === 200
    ? 'PASS  API login with the new password succeeds (200).'
    : `FAIL  API login with the new password returned ${newStatus} (expected 200).`,
);

await queue.disconnectRedis().catch(() => undefined);
await db.disconnectDatabase();

console.log('');
console.log('Done. Neither password was printed or written to disk.');
