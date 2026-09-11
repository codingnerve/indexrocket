import { SubmissionBatch, SubmissionBatchItem } from '@indexrocket/database';
import { Types } from 'mongoose';

/**
 * Recomputes a batch's counters from its items and closes the batch when every
 * item has reached a terminal state.
 *
 * The items collection is the authority. Counters on the batch document are a
 * cache maintained with atomic $inc for cheap list views, and this function
 * overwrites them with the truth — so a worker crash, a duplicated job or a
 * restart can never leave "completed: 10" next to eight completed items.
 */
export async function finaliseBatchIfDone(batchId: string): Promise<void> {
  if (!Types.ObjectId.isValid(batchId)) {
    return;
  }

  const rows = await SubmissionBatchItem.aggregate<{ _id: string; count: number }>([
    { $match: { batchId: new Types.ObjectId(batchId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts = { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    if (row._id in counts) {
      counts[row._id as keyof typeof counts] = row.count;
    }
  }

  const batch = await SubmissionBatch.findById(batchId);

  if (batch === null) {
    return;
  }

  const done = counts.pending === 0 && counts.processing === 0;
  const finished = counts.completed + counts.failed + counts.skipped;

  let status = batch.status;

  if (batch.status !== 'cancelled') {
    if (!done) {
      status = 'processing';
    } else if (finished === 0) {
      status = batch.status;
    } else if (counts.failed === 0) {
      status = 'completed';
    } else if (counts.completed === 0 && counts.skipped === 0) {
      status = 'failed';
    } else {
      status = 'completed_with_errors';
    }
  }

  await SubmissionBatch.updateOne(
    { _id: batchId },
    {
      $set: {
        ...counts,
        status,
        ...(done && batch.completedAt == null ? { completedAt: new Date() } : {}),
      },
    },
  );
}

/**
 * Marks an item failed when its job has run out of attempts.
 *
 * Without this, an item whose transient failures exhausted every retry would sit
 * in "processing" forever and its batch would never finish. Guarded on the
 * unfinished statuses, so an item a processor already finalised is untouched,
 * and any more specific error code recorded earlier is kept.
 */
export async function finalizeExhaustedItem(itemId: string, reason: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(itemId)) {
    return false;
  }

  const current = await SubmissionBatchItem.findOne({
    _id: itemId,
    status: { $in: ['pending', 'processing'] },
  }).select('batchId errorCode');

  if (current === null) {
    return false;
  }

  const updated = await SubmissionBatchItem.findOneAndUpdate(
    { _id: itemId, status: { $in: ['pending', 'processing'] } },
    {
      $set: {
        status: 'failed',
        errorCode: current.errorCode ?? 'retries_exhausted',
        errorMessage: reason.slice(0, 500),
        completedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );

  if (updated === null) {
    return false;
  }

  await finaliseBatchIfDone(updated.batchId.toString());

  return true;
}
