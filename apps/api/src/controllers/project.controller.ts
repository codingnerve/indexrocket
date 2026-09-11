import { Project, Url, type ProjectDocument } from '@indexrocket/database';
import { DomainValidationError, parseProjectDomain } from '@indexrocket/utils';
import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';

import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { loadOwnedProject, loadOwnedProjectWithKey } from '../services/ownership.js';

interface ProjectView {
  id: string;
  name: string;
  domain: string;
  /** Whether an IndexNow key is configured. The key itself is never returned. */
  hasIndexNowKey: boolean;
  indexNowKeyLocation: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The only project shape that leaves the API. `indexNowKey` is deliberately
 * absent: callers only need to know whether one is configured.
 */
function toView(project: ProjectDocument, hasKey: boolean): ProjectView {
  return {
    id: project._id.toString(),
    name: project.name,
    domain: project.domain,
    hasIndexNowKey: hasKey,
    indexNowKeyLocation: project.indexNowKeyLocation ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function readName(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new HttpError(400, '"name" is required.');
    }

    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 200) {
    throw new HttpError(400, '"name" must be a string of 1-200 characters.');
  }

  return value.trim();
}

function readDomain(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new HttpError(400, '"domain" is required.');
    }

    return undefined;
  }

  try {
    return parseProjectDomain(value);
  } catch (error) {
    throw error instanceof DomainValidationError ? new HttpError(400, error.message) : error;
  }
}

/** One project per domain per user, checked in the application layer. */
async function assertDomainAvailable(
  userId: string,
  domain: string,
  excludeProjectId?: Types.ObjectId,
): Promise<void> {
  const clash = await Project.findOne({
    userId: new Types.ObjectId(userId),
    domain,
    ...(excludeProjectId === undefined ? {} : { _id: { $ne: excludeProjectId } }),
  }).select('_id');

  if (clash !== null) {
    throw new HttpError(409, `You already have a project for "${domain}".`);
  }
}

export async function createProject(
  req: Request,
  res: Response<{ success: true; data: ProjectView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;

    if (typeof req.body !== 'object' || req.body === null) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }

    const body = req.body as Record<string, unknown>;
    const name = readName(body['name'], true);
    const domain = readDomain(body['domain'], true);

    if (name === undefined || domain === undefined) {
      throw new HttpError(400, '"name" and "domain" are required.');
    }

    await assertDomainAvailable(userId, domain);

    const project = await Project.create({
      userId: new Types.ObjectId(userId),
      name,
      domain,
    });

    res.status(201).json({ success: true, data: toView(project, false) });
  } catch (error) {
    next(error);
  }
}

export async function listProjects(
  req: Request,
  res: Response<{ success: true; data: ProjectView[] }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;

    // Scoped to the session user; there is no way to widen this from the request.
    const projects = await Project.find({ userId: new Types.ObjectId(userId) })
      .select('+indexNowKey')
      .sort({ createdAt: -1 })
      .limit(200);

    res.status(200).json({
      success: true,
      data: projects.map((project) =>
        toView(project, typeof project.indexNowKey === 'string' && project.indexNowKey.trim() !== ''),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function getProject(
  req: Request<{ id: string }>,
  res: Response<{ success: true; data: ProjectView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await Project.findOne({
      _id: (await loadOwnedProject(userId, req.params.id))._id,
    }).select('+indexNowKey');

    if (project === null) {
      throw new HttpError(404, 'Project not found.');
    }

    res.status(200).json({
      success: true,
      data: toView(project, typeof project.indexNowKey === 'string' && project.indexNowKey.trim() !== ''),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Updates a project.
 *
 * Changing the domain is restricted on purpose. A project's domain is what
 * IndexNow host validation is checked against and what its URLs belong to, so:
 *
 *  - the domain cannot change while the project still holds URLs (they would be
 *    orphaned on a host the project no longer claims), and
 *  - any configured IndexNow key is cleared, because a key is only meaningful on
 *    the host it is published on. Carrying it across would let a project keep a
 *    key that was verified for a different domain.
 */
export async function updateProject(
  req: Request<{ id: string }>,
  res: Response<{ success: true; data: ProjectView }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProjectWithKey(userId, req.params.id);

    if (typeof req.body !== 'object' || req.body === null) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }

    const body = req.body as Record<string, unknown>;
    const name = readName(body['name'], false);
    const domain = readDomain(body['domain'], false);

    if (name === undefined && domain === undefined) {
      throw new HttpError(400, 'Nothing to update. Provide "name" and/or "domain".');
    }

    if (name !== undefined) {
      project.name = name;
    }


    if (domain !== undefined && domain !== project.domain) {
      const urlCount = await Url.countDocuments({ projectId: project._id });

      if (urlCount > 0) {
        throw new HttpError(
          409,
          `Cannot change the domain while the project holds ${urlCount} URL(s). Delete them first.`,
        );
      }

      await assertDomainAvailable(userId, domain, project._id);

      project.domain = domain;
      // The key was published on the previous host and is meaningless here.
      project.indexNowKey = null;
      project.indexNowKeyLocation = null;
    }

    await project.save();

    const hasKey = typeof project.indexNowKey === 'string' && project.indexNowKey.trim() !== '';

    res.status(200).json({ success: true, data: toView(project, hasKey) });
  } catch (error) {
    next(error);
  }
}

export async function deleteProject(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProject(userId, req.params.id);

    // A project's URLs belong to it; deleting the project removes them too,
    // otherwise they would be unreachable rows with no owner.
    const removed = await Url.deleteMany({ projectId: project._id });
    await Project.deleteOne({ _id: project._id });

    res.status(200).json({
      success: true,
      message: 'Project deleted.',
      deletedUrls: removed.deletedCount ?? 0,
    });
  } catch (error) {
    next(error);
  }
}

export interface ProjectSummary {
  totalUrls: number;
  inspection: { pending: number; inspected: number; failed: number };
  google: { indexed: number; notIndexed: number; unknown: number; notInspected: number };
  indexNow: { accepted: number; failed: number; pending: number; notSubmitted: number };
}

/**
 * Aggregated counts for one project.
 *
 * The three families are counted from three DIFFERENT fields and are never
 * mixed: `status` is our own inspection stage, `googleInspection.status` is what
 * Google reported, and `indexNowStatus` is whether a notification was accepted.
 * An IndexNow acceptance is not evidence of indexing and is never counted as one.
 */
export async function getProjectSummary(
  req: Request<{ id: string }>,
  res: Response<{ success: true; data: ProjectSummary }>,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = authenticatedUser(req).id;
    const project = await loadOwnedProject(userId, req.params.id);

    // One pass over the project's URLs; nothing is loaded into application memory.
    const [row] = await Url.aggregate<{
      totalUrls: number;
      inspectionPending: number;
      inspected: number;
      inspectionFailed: number;
      googleIndexed: number;
      googleNotIndexed: number;
      googleUnknown: number;
      googleNotInspected: number;
      indexNowAccepted: number;
      indexNowFailed: number;
      indexNowPending: number;
      indexNowNotSubmitted: number;
    }>([
      { $match: { projectId: project._id } },
      {
        $group: {
          _id: null,
          totalUrls: { $sum: 1 },

          inspectionPending: {
            $sum: { $cond: [{ $in: ['$status', ['queued', 'processing']] }, 1, 0] },
          },
          inspected: { $sum: { $cond: [{ $eq: ['$status', 'inspected'] }, 1, 0] } },
          inspectionFailed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },

          googleIndexed: {
            $sum: { $cond: [{ $eq: ['$googleInspection.status', 'indexed'] }, 1, 0] },
          },
          googleNotIndexed: {
            $sum: { $cond: [{ $eq: ['$googleInspection.status', 'not_indexed'] }, 1, 0] },
          },
          googleUnknown: {
            $sum: {
              $cond: [{ $in: ['$googleInspection.status', ['unknown', 'error']] }, 1, 0],
            },
          },
          googleNotInspected: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$googleInspection.status', null] }, null] }, 1, 0] },
          },

          indexNowAccepted: {
            $sum: { $cond: [{ $eq: ['$indexNowStatus', 'accepted'] }, 1, 0] },
          },
          indexNowFailed: { $sum: { $cond: [{ $eq: ['$indexNowStatus', 'failed'] }, 1, 0] } },
          indexNowPending: { $sum: { $cond: [{ $eq: ['$indexNowStatus', 'pending'] }, 1, 0] } },
          indexNowNotSubmitted: {
            $sum: {
              $cond: [
                { $in: [{ $ifNull: ['$indexNowStatus', 'not_submitted'] }, ['not_submitted']] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const empty: ProjectSummary = {
      totalUrls: 0,
      inspection: { pending: 0, inspected: 0, failed: 0 },
      google: { indexed: 0, notIndexed: 0, unknown: 0, notInspected: 0 },
      indexNow: { accepted: 0, failed: 0, pending: 0, notSubmitted: 0 },
    };

    if (row === undefined) {
      res.status(200).json({ success: true, data: empty });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        totalUrls: row.totalUrls,
        inspection: {
          pending: row.inspectionPending,
          inspected: row.inspected,
          failed: row.inspectionFailed,
        },
        google: {
          indexed: row.googleIndexed,
          notIndexed: row.googleNotIndexed,
          unknown: row.googleUnknown,
          notInspected: row.googleNotInspected,
        },
        indexNow: {
          accepted: row.indexNowAccepted,
          failed: row.indexNowFailed,
          pending: row.indexNowPending,
          notSubmitted: row.indexNowNotSubmitted,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
