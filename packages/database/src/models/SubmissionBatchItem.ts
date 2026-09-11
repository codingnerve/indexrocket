import { Schema, model, type Model, type Types } from 'mongoose';

export const BATCH_ITEM_STATUSES = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;
export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];

/** Per-stage outcome recorded on the item. */
export const STAGE_OUTCOMES = ['not_run', 'skipped', 'succeeded', 'failed'] as const;
export type StageOutcome = (typeof STAGE_OUTCOMES)[number];

/**
 * One URL inside one batch.
 *
 * A separate collection rather than an embedded array: items are paginated,
 * filtered by three independent statuses, and updated concurrently by workers.
 * Embedding would make every item write rewrite the whole batch document and
 * would put the batch under the 16MB limit at scale.
 *
 * IMPORTANT: these fields record what THIS BATCH did. They never replace the
 * canonical state on the Url document (`status`, `indexNowStatus`,
 * `googleInspection.status`), which remains the single source of truth for the
 * URL itself.
 */
export interface SubmissionBatchItemDocument {
  _id: Types.ObjectId;
  batchId: Types.ObjectId;
  projectId: Types.ObjectId;
  urlId: Types.ObjectId;
  url: string;

  status: BatchItemStatus;

  /** Our own inspection stage for this batch run. */
  inspectionStatus: StageOutcome;
  /** IndexNow notification stage. "succeeded" means the notification was accepted. */
  discoveryStatus: StageOutcome;
  /** Google URL Inspection stage; only runs when the batch enables it. */
  googleStatus: StageOutcome;

  /** Short machine-readable reason, e.g. "cooldown", "foreign_host". */
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Human-readable per-stage notes, safe to display. */
  notes: string[];

  attempts: number;
  startedAt?: Date | null;
  completedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const submissionBatchItemSchema = new Schema<SubmissionBatchItemDocument>(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'SubmissionBatch', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    urlId: { type: Schema.Types.ObjectId, ref: 'Url', required: true },
    url: { type: String, required: true, trim: true, maxlength: 2048 },

    status: { type: String, enum: BATCH_ITEM_STATUSES, default: 'pending', required: true },

    inspectionStatus: { type: String, enum: STAGE_OUTCOMES, default: 'not_run', required: true },
    discoveryStatus: { type: String, enum: STAGE_OUTCOMES, default: 'not_run', required: true },
    googleStatus: { type: String, enum: STAGE_OUTCOMES, default: 'not_run', required: true },

    errorCode: { type: String, maxlength: 64, default: null },
    errorMessage: { type: String, maxlength: 500, default: null },
    notes: { type: [String], default: [] },

    attempts: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A URL appears at most once per batch. This is the database-level guard that
// makes a duplicated or replayed job unable to create a second item.
submissionBatchItemSchema.index({ batchId: 1, urlId: 1 }, { unique: true });

// Serves the paginated, status-filtered item list.
submissionBatchItemSchema.index({ batchId: 1, status: 1, createdAt: 1 });

// Serves "is this URL already in an unfinished batch?" duplicate protection.
submissionBatchItemSchema.index({ urlId: 1, status: 1 });

// Serves the worker's startup recovery sweep: unfinished items, oldest first.
submissionBatchItemSchema.index({ status: 1, updatedAt: 1 });

export const SubmissionBatchItem: Model<SubmissionBatchItemDocument> =
  model<SubmissionBatchItemDocument>('SubmissionBatchItem', submissionBatchItemSchema);
