import {
  BATCH_ITEM_STATUSES,
  STAGE_OUTCOMES,
  SubmissionBatch,
  SubmissionBatchItem,
  Url,
  type SubmissionBatchDocument,
  type SubmissionBatchItemDocument,
} from '@indexrocket/database';
import { addSubmissionJob } from '@indexrocket/queue';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';

import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { getValidAccessToken } from '../services/google/connectionService.js';
import { loadOwnedProject } from '../services/ownership.js';
import { listProperties } from '@indexrocket/google';

/** A batch is bounded so one request cannot enqueue unbounded provider work. */
export const MAX_BATCH_URLS = 200;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface BatchView {
  id: string;
  projectId: string;
  status: string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  inspectGoogle: boolean;
  googleSiteUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

function toBatchView(batch: SubmissionBatchDocument, counts?: Record<string, number>): BatchView {
  return {
    id: batch._id.toString(),
    projectId: batch.projectId.toString(),
    status: batch.status,
    total: batch.total,
    pending: counts?.['pending'] ?? batch.pending,
    processing: counts?.['processing'] ?? batch.processing,
    completed: counts?.['completed'] ?? batch.completed,
    failed: counts?.['failed'] ?? batch.failed,
    skipped: counts?.['skipped'] ?? batch.skipped,
    inspectGoogle: batch.inspectGoogle,
    googleSiteUrl: batch.googleSiteUrl ?? null,
    createdAt: batch.createdAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    cancelledAt: batch.cancelledAt?.toISOString() ?? null,
  };
}

function toItemView(item: SubmissionBatchItemDocument): Record<string, unknown> {
  return {
    id: item._id.toString(),
    urlId: item.urlId.toString(),
    url: item.url,
    status: item.status,
    inspectionStatus: item.inspectionStatus,
    discoveryStatus: item.discoveryStatus,
    googleStatus: item.googleStatus,
    errorCode: item.errorCode ?? null,
    errorMessage: item.errorMessage ?? null,
    notes: item.notes,
    attempts: item.attempts,
    startedAt: item.startedAt?.toISOString() ?? null,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

/**
 * Recomputes counters from the items collection.
 *
 * The items are the authority; the counters cached on the batch exist only so a
 * list view is cheap. Reading a batch always reconciles, which is what keeps a
 * crashed or duplicated worker from leaving a permanently wrong number.
 */
async function reconcile(batchId: Types.ObjectId): Promise<Record<string, number>> {
  const rows = await SubmissionBatchItem.aggregate<{ _id: string; count: number }>([
    { $match: { batchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const counts: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    counts[row._id] = row.count;
  }

  await SubmissionBatch.updateOne({ _id: batchId }, { $set: counts });

  return counts;
}

async function loadOwnedBatch(
  userId: string,
  projectId: string,
  batchId: string,
): Promise<SubmissionBatchDocument> {
  const project = await loadOwnedProject(userId, projectId);

  if (!Types.ObjectId.isValid(batchId)) {
    throw new HttpError(400, '"batchId" is not a valid MongoDB ObjectId.');
  }

  // Scoped by project AND user: neither id alone is sufficient.
  const batch = await SubmissionBatch.findOne({
    _id: new Types.ObjectId(batchId),
    projectId: project._id,
    userId: new Types.ObjectId(userId),
  });

  if (batch === null) {
    throw new HttpError(404, 'Batch not found.');
  }

  return batch;
}

/**
 * Creates a batch and enqueues one job per URL.
 *
 * No provider work happens here: the response returns as soon as the batch and
 * its items are persisted and the jobs are queued.
 */
export async function createBatch(
  req: Request<{ projectId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProject(userId, req.params.projectId);

    if (typeof req.body !== 'object' || req.body === null) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }

    const body = req.body as Record<string, unknown>;
    const rawIds = body['urlIds'];

    if (!Array.isArray(rawIds)) {
      throw new HttpError(400, '"urlIds" must be an array.');
    }

    if (rawIds.length === 0) {
      throw new HttpError(400, '"urlIds" must contain at least one URL id.');
    }

    if (rawIds.length > MAX_BATCH_URLS) {
      throw new HttpError(400, `A batch may contain at most ${MAX_BATCH_URLS} URLs.`);
    }

    // Deduplicate before anything else so a repeated id cannot become two items.
    const unique = [...new Set(rawIds.map((value) => String(value)))];

    for (const id of unique) {
      if (!Types.ObjectId.isValid(id)) {
        throw new HttpError(400, `"${id}" is not a valid URL id.`);
      }
    }

    // Every id must resolve inside THIS project; a cross-project id is rejected
    // rather than silently dropped.
    const urls = await Url.find({
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
      projectId: project._id,
    }).select('_id url');

    if (urls.length !== unique.length) {
      throw new HttpError(400, 'One or more URL ids do not belong to this project.');
    }

    const inspectGoogle = body['inspectGoogle'] === true;
    let googleSiteUrl: string | null = null;

    if (inspectGoogle) {
      const requested = body['googleSiteUrl'];

      if (typeof requested !== 'string' || requested.trim() === '') {
        throw new HttpError(400, '"googleSiteUrl" is required when "inspectGoogle" is true.');
      }

      // Verified up front so a batch never starts against a property the
      // connected Google account does not actually hold.
      const token = await getValidAccessToken(userId);
      const properties = await listProperties(token);
      const match = properties.find((entry) => entry.siteUrl === requested.trim());

      if (match === undefined) {
        throw new HttpError(403, 'The connected Google account does not have access to that property.');
      }

      googleSiteUrl = match.siteUrl;
    }

    // Duplicate protection: a URL already queued or running in another batch is
    // not enqueued again. The 24h IndexNow cooldown remains authoritative on top.
    const active = await SubmissionBatchItem.find({
      urlId: { $in: urls.map((url) => url._id) },
      status: { $in: ['pending', 'processing'] },
    }).select('urlId');

    const busy = new Set(active.map((item) => item.urlId.toString()));
    const accepted = urls.filter((url) => !busy.has(url._id.toString()));

    if (accepted.length === 0) {
      throw new HttpError(409, 'Every selected URL is already part of an unfinished batch.');
    }

    const batch = await SubmissionBatch.create({
      userId: new Types.ObjectId(userId),
      projectId: project._id,
      status: 'pending',
      total: accepted.length,
      pending: accepted.length,
      inspectGoogle,
      googleSiteUrl,
    });

    const items = await SubmissionBatchItem.insertMany(
      accepted.map((url) => ({
        batchId: batch._id,
        projectId: project._id,
        urlId: url._id,
        url: url.url,
        status: 'pending',
      })),
      { ordered: false },
    );

    for (const item of items) {
      await addSubmissionJob({
        batchId: batch._id.toString(),
        itemId: item._id.toString(),
        projectId: project._id.toString(),
        userId,
        urlId: item.urlId.toString(),
        url: item.url,
        inspectGoogle,
        googleSiteUrl,
      });
    }

    res.status(202).json({
      success: true,
      message: 'Batch queued',
      data: toBatchView(batch),
      summary: {
        requested: rawIds.length,
        deduplicated: rawIds.length - unique.length,
        alreadyInFlight: unique.length - accepted.length,
        queued: accepted.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listBatches(
  req: Request<{ projectId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProject(userId, req.params.projectId);

    const rawPage = Number(req.query['page'] ?? 1);
    const rawLimit = Number(req.query['limit'] ?? DEFAULT_PAGE_SIZE);
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    const filter = { projectId: project._id, userId: new Types.ObjectId(userId) };

    const [batches, total] = await Promise.all([
      SubmissionBatch.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SubmissionBatch.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: batches.map((batch) => toBatchView(batch)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getBatch(
  req: Request<{ projectId: string; batchId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const batch = await loadOwnedBatch(userId, req.params.projectId, req.params.batchId);

    // Always reconciled from the items, which are the authority.
    const counts = await reconcile(batch._id);

    res.status(200).json({ success: true, data: toBatchView(batch, counts) });
  } catch (error) {
    next(error);
  }
}

export async function listBatchItems(
  req: Request<{ projectId: string; batchId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const batch = await loadOwnedBatch(userId, req.params.projectId, req.params.batchId);

    const rawPage = Number(req.query['page'] ?? 1);
    const rawLimit = Number(req.query['limit'] ?? DEFAULT_PAGE_SIZE);
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    const filter: Record<string, unknown> = { batchId: batch._id };

    const status = req.query['status'];

    if (typeof status === 'string' && status !== '' && status !== 'all') {
      if (!(BATCH_ITEM_STATUSES as readonly string[]).includes(status)) {
        throw new HttpError(400, `"status" must be one of: ${BATCH_ITEM_STATUSES.join(', ')}.`);
      }

      filter['status'] = status;
    }

    for (const [param, field] of [
      ['discoveryStatus', 'discoveryStatus'],
      ['googleStatus', 'googleStatus'],
      ['inspectionStatus', 'inspectionStatus'],
    ] as const) {
      const value = req.query[param];

      if (typeof value === 'string' && value !== '' && value !== 'all') {
        if (!(STAGE_OUTCOMES as readonly string[]).includes(value)) {
          throw new HttpError(400, `"${param}" must be one of: ${STAGE_OUTCOMES.join(', ')}.`);
        }

        filter[field] = value;
      }
    }

    const [items, total] = await Promise.all([
      SubmissionBatchItem.find(filter)
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      SubmissionBatchItem.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: items.map(toItemView),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Cancels a batch.
 *
 * SEMANTICS: cancellation stops work that has not started. Items still pending
 * become `skipped` and their queued jobs exit at claim time. An item already in
 * flight is allowed to finish, because a provider request that has been sent
 * cannot be recalled — an IndexNow notification already accepted stays accepted,
 * and this endpoint never pretends otherwise.
 */
export async function cancelBatch(
  req: Request<{ projectId: string; batchId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const batch = await loadOwnedBatch(userId, req.params.projectId, req.params.batchId);

    if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(batch.status)) {
      throw new HttpError(409, `Batch is already ${batch.status} and cannot be cancelled.`);
    }

    await SubmissionBatch.updateOne(
      { _id: batch._id },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    );

    const skipped = await SubmissionBatchItem.updateMany(
      { batchId: batch._id, status: 'pending' },
      {
        $set: {
          status: 'skipped',
          errorCode: 'cancelled',
          errorMessage: 'Batch was cancelled before this URL started.',
          completedAt: new Date(),
        },
      },
    );

    const counts = await reconcile(batch._id);
    const stillRunning = counts['processing'] ?? 0;

    res.status(200).json({
      success: true,
      message: 'Batch cancelled.',
      cancelledPending: skipped.modifiedCount ?? 0,
      stillProcessing: stillRunning,
      note:
        stillRunning > 0
          ? 'URLs already in flight will finish; a notification that was already sent cannot be recalled.'
          : 'No URLs were in flight.',
    });
  } catch (error) {
    next(error);
  }
}
