import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * pending              - created, no item has started
 * processing           - at least one item is in flight
 * completed            - every item finished and none failed
 * completed_with_errors- every item finished, some failed
 * failed               - every item failed
 * cancelled            - cancelled before all items finished
 */
export const BATCH_STATUSES = [
  'pending',
  'processing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface SubmissionBatchDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  status: BatchStatus;

  /** Item count at creation. Fixed for the life of the batch. */
  total: number;

  /**
   * Cached progress counters, maintained with atomic $inc as items finish.
   *
   * They are a convenience for list views only. The batch detail endpoint
   * recomputes them from the items collection, which is the authority, so a
   * crashed or duplicated worker can never leave a permanently wrong number
   * on display. See reconcileBatchCounters in the API.
   */
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;

  /**
   * Whether this batch also runs Google URL Inspection. Off by default: Google
   * has real quotas and a batch must never spend them implicitly.
   */
  inspectGoogle: boolean;
  /** Search Console property used when inspectGoogle is on. */
  googleSiteUrl?: string | null;

  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const submissionBatchSchema = new Schema<SubmissionBatchDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: BATCH_STATUSES, default: 'pending', required: true },

    total: { type: Number, required: true, min: 0 },
    pending: { type: Number, default: 0 },
    processing: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },

    inspectGoogle: { type: Boolean, default: false, required: true },
    googleSiteUrl: { type: String, trim: true, maxlength: 2048, default: null },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Serves the project's batch list, newest first.
submissionBatchSchema.index({ projectId: 1, createdAt: -1 });

// Serves "my batches" and the ownership check on every batch route.
submissionBatchSchema.index({ userId: 1, createdAt: -1 });

export const SubmissionBatch: Model<SubmissionBatchDocument> = model<SubmissionBatchDocument>(
  'SubmissionBatch',
  submissionBatchSchema,
);
