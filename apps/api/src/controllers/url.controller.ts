import { Url } from '@indexrocket/database';
import { addDiscoveryJob, addUrlInspectionJob } from '@indexrocket/queue';
import {
  assertSafeUrl,
  evaluateDiscoveryEligibility,
  normalizeUrl,
  SsrfBlockedError,
  UrlValidationError,
} from '@indexrocket/utils';
import type { NextFunction, Request, Response } from 'express';


import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { loadOwnedProject, loadOwnedUrl } from '../services/ownership.js';
import { toUrlView, type UrlView } from '../services/urlView.js';

interface InspectResponse {
  success: true;
  message: string;
  urlId: string;
  jobId: string;
  url: string;
}

interface UrlDetailResponse {
  success: true;
  data: UrlView;
}

function readBody(body: unknown): { projectId: string; url: string } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  const { projectId, url } = body as Record<string, unknown>;

  if (typeof projectId !== 'string' || projectId.trim() === '') {
    throw new HttpError(400, '"projectId" is required and must be a non-empty string.');
  }

  if (typeof url !== 'string' || url.trim() === '') {
    throw new HttpError(400, '"url" is required and must be a non-empty string.');
  }

  return { projectId: projectId.trim(), url: url.trim() };
}

/**
 * Accepts a URL for inspection.
 *
 * The client-supplied projectId is treated as a candidate only: the project is
 * loaded scoped to the authenticated user, so a URL can never be attached to
 * somebody else's project.
 */
export async function inspectUrl(
  req: Request,
  res: Response<InspectResponse>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const { projectId, url } = readBody(req.body);

    const project = await loadOwnedProject(userId, projectId);

    let normalized: string;

    try {
      normalized = normalizeUrl(url);
    } catch (error) {
      throw error instanceof UrlValidationError ? new HttpError(400, error.message) : error;
    }

    // Reject internal targets up front so they never reach the queue.
    try {
      await assertSafeUrl(normalized);
    } catch (error) {
      throw error instanceof SsrfBlockedError ? new HttpError(400, error.message) : error;
    }

    const document = await Url.findOneAndUpdate(
      { projectId: project._id, url: normalized },
      {
        $set: { status: 'queued', normalizedUrl: normalized, inspectionError: null },
        $setOnInsert: {
          projectId: project._id,
          url: normalized,
          submittedAt: new Date(),
        },
      },
      { returnDocument: 'after', upsert: true },
    );

    const urlId = document._id.toString();
    const jobId = await addUrlInspectionJob({
      urlId,
      projectId: project._id.toString(),
      url: normalized,
    });

    res.status(202).json({
      success: true,
      message: 'URL inspection queued',
      urlId,
      jobId,
      url: normalized,
    });
  } catch (error) {
    next(error);
  }
}

export async function getUrl(
  req: Request<{ id: string }>,
  res: Response<UrlDetailResponse>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const { url } = await loadOwnedUrl(userId, req.params.id);

    res.status(200).json({ success: true, data: toUrlView(url) });
  } catch (error) {
    next(error);
  }
}

interface DiscoverResponse {
  success: true;
  message: string;
  urlId: string;
  jobId: string;
}

/**
 * Queues a discovery notification for one URL.
 *
 * The URL is resolved through its project to the authenticated user first, so a
 * user can never trigger a notification using another account's IndexNow key.
 */
export async function discoverUrl(
  req: Request<{ id: string }>,
  res: Response<DiscoverResponse>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const { url: document, project } = await loadOwnedUrl(userId, req.params.id, true);

    const hasKey = typeof project.indexNowKey === 'string' && project.indexNowKey.trim() !== '';

    const verdict = evaluateDiscoveryEligibility(
      {
        status: document.status,
        httpStatus: document.httpStatus ?? null,
        url: document.url,
        indexNowStatus: document.indexNowStatus ?? null,
        indexNowSubmittedAt: document.indexNowSubmittedAt ?? null,
      },
      { domain: project.domain, hasIndexNowKey: hasKey },
    );

    if (!verdict.eligible) {
      throw new HttpError(409, verdict.reason);
    }

    const jobId = await addDiscoveryJob({
      projectId: project._id.toString(),
      urlIds: [document._id.toString()],
    });

    await Url.updateOne({ _id: document._id }, { $set: { indexNowStatus: 'pending' } });

    res.status(202).json({
      success: true,
      message: 'URL discovery queued',
      urlId: document._id.toString(),
      jobId,
    });
  } catch (error) {
    next(error);
  }
}

