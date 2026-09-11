import { Project, Url, type ProjectDocument, type UrlDocument } from '@indexrocket/database';
import { Types, type HydratedDocument } from 'mongoose';

import { HttpError } from '../middleware/httpError.js';

/**
 * Ownership checks for every user-owned resource.
 *
 * The rule is single and absolute: an identifier supplied by the client is only
 * ever a *candidate*. It is resolved against the database and rejected unless the
 * resource resolves back to the authenticated user.
 *
 * Missing and forbidden both answer 404. Returning 403 for a resource that exists
 * but belongs to someone else would confirm its existence, which turns these
 * endpoints into an enumeration oracle for other users' project and URL ids.
 */
const NOT_FOUND_PROJECT = 'Project not found.';
const NOT_FOUND_URL = 'URL not found.';

export function assertObjectId(value: string, label: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new HttpError(400, `"${label}" is not a valid MongoDB ObjectId.`);
  }

  return new Types.ObjectId(value);
}

/** Loads a project only if the authenticated user owns it. */
export async function loadOwnedProject(userId: string, projectId: string): Promise<HydratedDocument<ProjectDocument>> {
  const id = assertObjectId(projectId, 'projectId');

  const project = await Project.findOne({ _id: id, userId: new Types.ObjectId(userId) });

  if (project === null) {
    throw new HttpError(404, NOT_FOUND_PROJECT);
  }

  return project;
}

/**
 * Same as {@link loadOwnedProject} but also selects the IndexNow key, for the
 * paths that need to know whether one is configured.
 */
export async function loadOwnedProjectWithKey(
  userId: string,
  projectId: string,
): Promise<HydratedDocument<ProjectDocument>> {
  const id = assertObjectId(projectId, 'projectId');

  const project = await Project.findOne({ _id: id, userId: new Types.ObjectId(userId) }).select(
    '+indexNowKey',
  );

  if (project === null) {
    throw new HttpError(404, NOT_FOUND_PROJECT);
  }

  return project;
}

export interface OwnedUrl {
  url: HydratedDocument<UrlDocument>;
  project: HydratedDocument<ProjectDocument>;
}

/**
 * Resolves a URL through its project to the authenticated user.
 *
 * The chain is URL -> project -> user; a URL whose project belongs to somebody
 * else is indistinguishable from one that does not exist.
 */
export async function loadOwnedUrl(userId: string, urlId: string, withKey = false): Promise<OwnedUrl> {
  const id = assertObjectId(urlId, 'id');
  const url = await Url.findById(id);

  if (url === null) {
    throw new HttpError(404, NOT_FOUND_URL);
  }

  const query = Project.findOne({ _id: url.projectId, userId: new Types.ObjectId(userId) });
  const project = await (withKey ? query.select('+indexNowKey') : query);

  if (project === null) {
    throw new HttpError(404, NOT_FOUND_URL);
  }

  return { url, project };
}
