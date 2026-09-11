export {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
  isDatabaseConnected,
  type ConnectDatabaseOptions,
  type DatabaseStatus,
} from './connection.js';

export { User, USER_PLANS, USER_ROLES, type UserDocument, type UserPlan, type UserRole } from './models/User.js';
export { Project, type ProjectDocument } from './models/Project.js';
export {
  GoogleConnection,
  GOOGLE_CONNECTION_STATUSES,
  type GoogleConnectionDocument,
  type GoogleConnectionStatusValue,
} from './models/GoogleConnection.js';
export {
  Url,
  CANONICAL_TYPES,
  GOOGLE_INSPECTION_STATUSES,
  INDEXNOW_STATUSES,
  URL_STATUSES,
  type CanonicalTypeValue,
  type GoogleInspectionStatusValue,
  type GoogleInspectionSubdocument,
  type IndexNowStatusValue,
  type UrlDocument,
  type UrlStatus,
} from './models/Url.js';

export {
  SubmissionBatch,
  BATCH_STATUSES,
  type BatchStatus,
  type SubmissionBatchDocument,
} from './models/SubmissionBatch.js';
export {
  SubmissionBatchItem,
  BATCH_ITEM_STATUSES,
  STAGE_OUTCOMES,
  type BatchItemStatus,
  type StageOutcome,
  type SubmissionBatchItemDocument,
} from './models/SubmissionBatchItem.js';

export { pingDatabase } from './connection.js';
