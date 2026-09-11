/**
 * ONE-TIME project ownership migration: FlyVentures project
 *   step9@indexrocket.local  ->  cocdeal93@gmail.com
 *
 * Changes exactly one field on exactly one document: Project.userId.
 * Nothing is deleted, recreated or re-keyed. URLs are not written at all.
 *
 * Modes (dry-run unless --apply is present):
 *   node scripts/migrate-project-ownership.mjs                       forward, dry-run
 *   node scripts/migrate-project-ownership.mjs --apply               forward, APPLY
 *   node scripts/migrate-project-ownership.mjs --rollback            rollback, dry-run
 *   node scripts/migrate-project-ownership.mjs --rollback --apply    rollback, APPLY
 *
 * Why the native driver: the Project schema has `timestamps: true`, so a
 * Mongoose update would silently bump updatedAt. Going through the raw
 * collection changes userId and nothing else, which preserves every timestamp.
 *
 * Why no transaction: the local deployment is a standalone mongod, which does
 * not support multi-document transactions. The change is a single-document
 * update, which MongoDB applies atomically anyway; it is guarded by a filter on
 * the expected current owner and domain, and verified immediately afterwards.
 *
 * Never printed: passwords, password hashes, OAuth tokens, encryption keys or
 * the IndexNow key. Only fingerprints and booleans are shown for sensitive data.
 */
import { createHash } from 'node:crypto';
import process from 'node:process';

const db = await import('file:///C:/Project/indexrocket/packages/database/dist/index.js');
const mongoose = (await import('file:///C:/Project/indexrocket/node_modules/mongoose/index.js')).default;
const { Types } = mongoose;

const SOURCE = { id: '6aa081543c97a12b397ae457', email: 'step9@indexrocket.local' };
const TARGET = { id: '6aa43682e7621a31668d6bd7', email: 'cocdeal93@gmail.com' };
const PROJECT_ID = '6aa07187dfb46fdba0ae4c1d';
const DOMAIN = 'theflyventures.com';
const EXPECTED_URLS = 6;

const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/indexrocket';

// Forward moves SOURCE -> TARGET; rollback moves TARGET -> SOURCE.
const from = rollback ? TARGET : SOURCE;
const to = rollback ? SOURCE : TARGET;

function fail(message) {
  console.error(`ABORT: ${message}`);
  console.error('Nothing was changed.');
  process.exitCode = 1;
}

/** Stable JSON: object keys sorted, so a fingerprint depends on content only. */
function stable(value) {
  if (value instanceof Types.ObjectId) return `oid:${value.toString()}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stable(value)).digest('hex').slice(0, 16);
}

/** Everything on the project except the one field this script is allowed to change. */
function projectWithoutOwner(project) {
  const { userId: _omit, ...rest } = project;
  return rest;
}

await db.connectDatabase({ uri: mongoUri });

const users = mongoose.connection.db.collection('users');
const projects = mongoose.connection.db.collection('projects');
const urls = mongoose.connection.db.collection('urls');

try {
  const sourceUser = await users.findOne(
    { _id: new Types.ObjectId(SOURCE.id) },
    { projection: { _id: 1, email: 1 } },
  );
  const targetUser = await users.findOne(
    { _id: new Types.ObjectId(TARGET.id) },
    { projection: { _id: 1, email: 1 } },
  );
  const project = await projects.findOne({ _id: new Types.ObjectId(PROJECT_ID) });

  console.log(`Mode: ${rollback ? 'ROLLBACK' : 'FORWARD'} ${apply ? '(APPLY)' : '(DRY RUN)'}`);
  console.log('');

  // --- guards -------------------------------------------------------------
  if (sourceUser === null) {
    fail(`source user ${SOURCE.id} does not exist.`);
  } else if (sourceUser.email !== SOURCE.email) {
    fail(`source user ${SOURCE.id} has an unexpected email.`);
  } else if (targetUser === null) {
    fail(`target user ${TARGET.id} does not exist.`);
  } else if (targetUser.email !== TARGET.email) {
    fail(`target user ${TARGET.id} has an unexpected email.`);
  } else if (project === null) {
    fail(`project ${PROJECT_ID} does not exist.`);
  } else if (project.domain !== DOMAIN) {
    fail(`project domain is "${project.domain}", expected "${DOMAIN}".`);
  } else if (String(project.userId) === to.id) {
    fail(`project is already owned by ${to.email}, the destination for this mode. Nothing to do.`);
  } else if (String(project.userId) !== from.id) {
    fail(`project is owned by an unexpected user, expected ${from.email}.`);
  } else {
    const urlDocs = await urls.find({ projectId: project._id }).sort({ _id: 1 }).toArray();

    if (urlDocs.length !== EXPECTED_URLS) {
      fail(`project has ${urlDocs.length} URLs, expected exactly ${EXPECTED_URLS}.`);
    } else {
      // The app enforces one project per domain per user; refuse to create a clash.
      const clash = await projects.countDocuments({
        _id: { $ne: project._id },
        userId: new Types.ObjectId(to.id),
        domain: DOMAIN,
      });

      if (clash > 0) {
        fail(`${to.email} already owns another project for ${DOMAIN}.`);
      } else {
        const beforeProject = fingerprint(projectWithoutOwner(project));
        const beforeUrls = urlDocs.map((doc) => ({ id: String(doc._id), fp: fingerprint(doc) }));

        const googleFrom = await mongoose.connection.db
          .collection('googleconnections')
          .countDocuments({ userId: new Types.ObjectId(from.id) });
        const googleTo = await mongoose.connection.db
          .collection('googleconnections')
          .countDocuments({ userId: new Types.ObjectId(to.id) });
        const batches = await mongoose.connection.db
          .collection('submissionbatches')
          .countDocuments({ projectId: project._id, userId: new Types.ObjectId(from.id) });

        console.log('Safe metadata');
        console.log(`  from (current owner) : ${from.email}`);
        console.log(`  to   (new owner)     : ${to.email}`);
        console.log(`  project name         : ${project.name}`);
        console.log(`  domain               : ${project.domain}`);
        console.log(`  project id           : ${PROJECT_ID}`);
        console.log(`  URL count            : ${urlDocs.length}`);
        console.log(`  IndexNow key set     : ${typeof project.indexNowKey === 'string' && project.indexNowKey !== ''}`);
        console.log(`  project fingerprint  : ${beforeProject}  (all fields except userId)`);
        console.log('');
        console.log('Proposed change');
        console.log(`  projects.${PROJECT_ID}.userId : ${from.id} -> ${to.id}`);
        console.log('  nothing else is written (URLs, users, Google connections, batches untouched)');
        console.log('');
        console.log('Not modified by design (review these)');
        console.log(`  Google connections owned by ${from.email}: ${googleFrom}; by ${to.email}: ${googleTo}`);
        console.log(`  submission batches for this project owned by ${from.email}: ${batches}`);

        if (!apply) {
          console.log('');
          console.log('DRY RUN complete. No changes were made.');
        } else {
          // Guarded single-document update: it matches only if the project is
          // still exactly as verified above. Native driver => updatedAt untouched.
          const result = await projects.updateOne(
            {
              _id: project._id,
              userId: new Types.ObjectId(from.id),
              domain: DOMAIN,
            },
            { $set: { userId: new Types.ObjectId(to.id) } },
          );

          if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
            fail(`guarded update matched ${result.matchedCount}, modified ${result.modifiedCount}.`);
          } else {
            // --- verification ---------------------------------------------
            const afterProjectDoc = await projects.findOne({ _id: project._id });
            const afterUrlDocs = await urls.find({ projectId: project._id }).sort({ _id: 1 }).toArray();
            const afterUrls = afterUrlDocs.map((doc) => ({ id: String(doc._id), fp: fingerprint(doc) }));

            const checks = [
              ['project.userId == new owner', String(afterProjectDoc.userId) === to.id],
              ['project _id preserved', String(afterProjectDoc._id) === PROJECT_ID],
              [
                'every other project field unchanged (incl. timestamps, IndexNow config)',
                fingerprint(projectWithoutOwner(afterProjectDoc)) === beforeProject,
              ],
              [`URL count still ${EXPECTED_URLS}`, afterUrlDocs.length === EXPECTED_URLS],
              [
                'URL _ids unchanged',
                JSON.stringify(afterUrls.map((u) => u.id)) === JSON.stringify(beforeUrls.map((u) => u.id)),
              ],
              ['every URL projectId unchanged', afterUrlDocs.every((doc) => String(doc.projectId) === PROJECT_ID)],
              [
                'every URL document byte-for-byte unchanged (inspection, IndexNow, Google, timestamps)',
                afterUrls.every((u, i) => u.fp === beforeUrls[i]?.fp),
              ],
            ];

            console.log('');
            console.log('Verification');

            let allPassed = true;

            for (const [label, ok] of checks) {
              console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
              if (!ok) allPassed = false;
            }

            console.log('');
            console.log(allPassed ? 'APPLIED and verified.' : 'APPLIED but verification FAILED - investigate before use.');

            if (!allPassed) process.exitCode = 1;
          }
        }
      }
    }
  }
} finally {
  await db.disconnectDatabase();
}
