import { Url, URL_STATUSES, type ProjectDocument, type UrlDocument } from '@indexrocket/database';
import {
  assertSafeUrlShape,
  hostMatchesDomain,
  hostOfUrl,
  normalizeUrl,
  SsrfBlockedError,
  UrlValidationError,
} from '@indexrocket/utils';
import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { loadOwnedProject } from '../services/ownership.js';
import { toUrlView, type UrlView } from '../services/urlView.js';

/** Bulk import is bounded so one request can never become an unbounded write. */
export const MAX_BULK_URLS = 500;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Validates one URL for a project.
 *
 * Three gates, in order: it must parse as http/https, it must belong to the
 * project's host, and it must survive the SSRF check. The host gate is what
 * stops a project being used to store URLs it does not own, which would later
 * be handed to IndexNow.
 */
async function prepareUrl(raw: unknown, project: ProjectDocument): Promise<string> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, 'Each URL must be a non-empty string.');
  }

  let normalized: string;

  try {
    normalized = normalizeUrl(raw);
  } catch (error) {
    throw error instanceof UrlValidationError ? new HttpError(400, error.message) : error;
  }

  const host = hostOfUrl(normalized);

  if (host === null || !hostMatchesDomain(host, project.domain)) {
    throw new HttpError(
      400,
      `"${normalized}" does not belong to project domain "${project.domain}".`,
    );
  }

  // Storing a URL is not fetching one: the scheme, hostname namespace and any
  // literal IP are checked here, and the full DNS-resolving guard with address
  // pinning runs before any request is made (queueing and the worker itself).
  try {
    assertSafeUrlShape(normalized);
  } catch (error) {
    throw error instanceof SsrfBlockedError ? new HttpError(400, error.message) : error;
  }

  return normalized;
}

/**
 * Adds one URL. Creation is idempotent: submitting a URL the project already
 * holds returns the existing record rather than erroring, because "make sure
 * this URL is tracked" is the caller's actual intent.
 *
 * The URL is NOT fetched here. Inspection is a separate, queued operation.
 */
export async function addProjectUrl(
  req: Request<{ projectId: string }>,
  res: Response<{ success: true; created: boolean; data: UrlView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProject(userId, req.params.projectId);

    if (typeof req.body !== 'object' || req.body === null) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }

    const normalized = await prepareUrl((req.body as Record<string, unknown>)['url'], project);
    const existing = await Url.findOne({ projectId: project._id, url: normalized });

    if (existing !== null) {
      res.status(200).json({ success: true, created: false, data: toUrlView(existing) });
      return;
    }

    const created = await Url.create({
      projectId: project._id,
      url: normalized,
      normalizedUrl: normalized,
      status: 'queued',
      submittedAt: new Date(),
    });

    res.status(201).json({ success: true, created: true, data: toUrlView(created) });
  } catch (error) {
    next(error);
  }
}

interface BulkOutcome {
  url: string;
  status: 'created' | 'duplicate' | 'rejected';
  reason?: string;
  id?: string;
}

/**
 * Bulk import.
 *
 * Every entry is validated individually and a per-URL outcome is returned, so a
 * single bad row never discards the whole batch. Writes go through one
 * `insertMany` with `ordered: false`, keeping the operation bounded by
 * {@link MAX_BULK_URLS}. No inspection is enqueued.
 */
export async function addProjectUrlsBulk(
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

    const urls = (req.body as Record<string, unknown>)['urls'];

    if (!Array.isArray(urls)) {
      throw new HttpError(400, '"urls" must be an array.');
    }

    if (urls.length === 0) {
      throw new HttpError(400, '"urls" must contain at least one URL.');
    }

    if (urls.length > MAX_BULK_URLS) {
      throw new HttpError(400, `At most ${MAX_BULK_URLS} URLs may be imported per request.`);
    }

    const results: BulkOutcome[] = [];
    const accepted = new Map<string, number>();

    for (const raw of urls) {
      const label = typeof raw === 'string' ? raw.slice(0, 300) : String(raw).slice(0, 300);

      try {
        const normalized = await prepareUrl(raw, project);

        if (accepted.has(normalized)) {
          results.push({ url: normalized, status: 'duplicate', reason: 'Repeated in this request.' });
          continue;
        }

        accepted.set(normalized, results.length);
        results.push({ url: normalized, status: 'created' });
      } catch (error) {
        results.push({
          url: label,
          status: 'rejected',
          reason: error instanceof HttpError ? error.message : 'Invalid URL.',
        });
      }
    }

    const candidates = [...accepted.keys()];

    if (candidates.length > 0) {
      const existing = await Url.find({ projectId: project._id, url: { $in: candidates } }).select('url');
      const existingSet = new Set(existing.map((entry) => entry.url));
      const toInsert = candidates.filter((url) => !existingSet.has(url));

      for (const url of candidates) {
        const index = accepted.get(url);

        if (index !== undefined && existingSet.has(url)) {
          results[index] = { url, status: 'duplicate', reason: 'Already tracked by this project.' };
        }
      }

      if (toInsert.length > 0) {
        const now = new Date();
        const inserted = await Url.insertMany(
          toInsert.map((url) => ({
            projectId: project._id,
            url,
            normalizedUrl: url,
            status: 'queued',
            submittedAt: now,
          })),
          { ordered: false },
        );

        for (const document of inserted) {
          const index = accepted.get(document.url);

          if (index !== undefined) {
            results[index] = { url: document.url, status: 'created', id: document._id.toString() };
          }
        }
      }
    }

    const created = results.filter((entry) => entry.status === 'created').length;
    const duplicates = results.filter((entry) => entry.status === 'duplicate').length;
    const rejected = results.filter((entry) => entry.status === 'rejected').length;

    res.status(created > 0 ? 201 : 200).json({
      success: true,
      summary: { submitted: urls.length, created, duplicates, rejected },
      results,
    });
  } catch (error) {
    next(error);
  }
}

/** Paginated, filterable URL listing. Never loads a whole project into memory. */
export async function listProjectUrls(
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

    const filter: Record<string, unknown> = { projectId: project._id };

    const status = req.query['status'];

    if (typeof status === 'string' && status !== '' && status !== 'all') {
      if (!(URL_STATUSES as readonly string[]).includes(status)) {
        throw new HttpError(400, `"status" must be one of: ${URL_STATUSES.join(', ')}.`);
      }

      filter.status = status;
    }

    const search = req.query['search'];

    if (typeof search === 'string' && search.trim() !== '') {
      // Escaped so a search string can never be interpreted as a regex.
      const escaped = search.trim().slice(0, 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.url = { $regex: escaped, $options: 'i' };
    }

    const [items, total] = await Promise.all([
      Url.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Url.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: items.map(toUrlView),
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

/** Resolves a URL through its project, so both ids must belong to the caller. */
async function loadProjectUrl(
  userId: string,
  projectId: string,
  urlId: string,
): Promise<{ project: ProjectDocument; url: UrlDocument }> {
  const project = await loadOwnedProject(userId, projectId);
  const url = await Url.findOne({ _id: urlId, projectId: project._id });

  if (url === null) {
    throw new HttpError(404, 'URL not found.');
  }

  return { project, url };
}

export async function getProjectUrl(
  req: Request<{ projectId: string; urlId: string }>,
  res: Response<{ success: true; data: UrlView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const { url } = await loadProjectUrl(userId, req.params.projectId, req.params.urlId);

    res.status(200).json({ success: true, data: toUrlView(url) });
  } catch (error) {
    next(error);
  }
}

export async function deleteProjectUrl(
  req: Request<{ projectId: string; urlId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const { url } = await loadProjectUrl(userId, req.params.projectId, req.params.urlId);

    await Url.deleteOne({ _id: url._id });

    res.status(200).json({ success: true, message: 'URL deleted.' });
  } catch (error) {
    next(error);
  }
}
