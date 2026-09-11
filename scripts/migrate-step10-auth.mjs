/**
 * Step 10 migration: make pre-authentication development data usable under real
 * authentication.
 *
 * Two things changed in Step 10:
 *
 *  1. Users now authenticate with a real password. Development User documents
 *     were created with a placeholder passwordHash that cannot verify, so they
 *     can never sign in until a real password is set.
 *
 *  2. Every user-owned resource is now ownership-checked. Development Projects
 *     were created with randomly generated `userId` values that point at no real
 *     User, so they are orphaned and unreachable by anybody.
 *
 * This script fixes both WITHOUT deleting anything. Existing Urls and the
 * GoogleConnection keep their relationships: the connection is already bound to
 * a real User and is not touched.
 *
 * Usage:
 *   node scripts/migrate-step10-auth.mjs --email <user email> --password <new password>
 *   node scripts/migrate-step10-auth.mjs --email <user email> --password <pw> --apply
 *
 * Without --apply it runs as a dry run and changes nothing.
 */
import process from 'node:process';

const db = await import('file:///C:/Project/indexrocket/packages/database/dist/index.js');
const utils = await import('file:///C:/Project/indexrocket/packages/utils/dist/index.js');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const email = arg('email');
const password = arg('password');
const apply = process.argv.includes('--apply');
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/indexrocket';

if (email === null) {
  console.error('Missing --email. See the header of this file for usage.');
  process.exit(1);
}

await db.connectDatabase({ uri: mongoUri });

const normalized = utils.normalizeEmail(email);
const user = await db.User.findOne({ email: normalized }).select('+passwordHash');

if (user === null) {
  console.error(`No User document with email ${normalized}. Nothing to migrate.`);
  await db.disconnectDatabase();
  process.exit(1);
}

console.log(`Target user: ${user._id} (${user.email})`);
console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
console.log('');

// --- 1. password -----------------------------------------------------------
const hasUsableHash =
  typeof user.passwordHash === 'string' && user.passwordHash.startsWith('scrypt$');

console.log('1. Password');

if (hasUsableHash) {
  console.log('   Already has a usable password hash; leaving it alone.');
} else if (password === null) {
  console.log('   Placeholder hash found, but no --password given. Skipping.');
} else {
  const policy = utils.checkPasswordPolicy(password);

  if (!policy.valid) {
    console.error(`   Refusing to set password: ${policy.reason}`);
    await db.disconnectDatabase();
    process.exit(1);
  }

  if (apply) {
    user.passwordHash = await utils.hashPassword(password);
    await user.save();
    console.log('   Password set (scrypt). The plaintext is never stored or logged.');
  } else {
    console.log('   Would set a new scrypt password hash.');
  }
}

// --- 2. orphaned projects --------------------------------------------------
console.log('');
console.log('2. Orphaned projects');

const users = await db.User.find({}).select('_id').lean();
const realIds = new Set(users.map((entry) => String(entry._id)));
const projects = await db.Project.find({}).select('_id name domain userId').lean();
const orphans = projects.filter((project) => !realIds.has(String(project.userId)));

if (orphans.length === 0) {
  console.log('   None. Every project already belongs to a real user.');
} else {
  for (const orphan of orphans) {
    console.log(`   ${apply ? 'reassigning' : 'would reassign'}: ${orphan.name} (${orphan.domain}) -> ${user._id}`);

    if (apply) {
      await db.Project.updateOne({ _id: orphan._id }, { $set: { userId: user._id } });
    }
  }
}

// --- 3. report what is preserved ------------------------------------------
console.log('');
console.log('3. Preserved relationships (not modified)');

const connection = await db.GoogleConnection.findOne({ userId: user._id });
console.log(
  `   GoogleConnection: ${connection === null ? 'none for this user' : `present, status=${connection.status}`}`,
);
console.log(`   Urls in database: ${await db.Url.countDocuments({})} (untouched)`);

await db.disconnectDatabase();
console.log('');
console.log(apply ? 'Migration applied.' : 'Dry run complete. Re-run with --apply to write.');
