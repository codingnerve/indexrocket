import { Project, Url } from '@indexrocket/database';
import { Types } from 'mongoose';
import type { GoogleInspectionSnapshot, SearchConsoleProperty } from '@indexrocket/types';
import { normalizeUrl, UrlValidationError } from '@indexrocket/utils';
import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../middleware/httpError.js';
import { authenticatedUser } from '../middleware/requireAuth.js';
import { getValidAccessToken } from '../services/google/connectionService.js';
import { GoogleHttpError, inspectUrlWithGoogle, listProperties, urlBelongsToProperty } from '@indexrocket/google';

/** Maps a Google API failure onto an honest client-facing status. */
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof GoogleHttpError) {
    if (error.status === 401) {
      return new HttpError(409, 'Google rejected the credentials. Reconnect Search Console.');
    }

    if (error.status === 403) {
      return new HttpError(403, 'The connected Google account does not have access to this property.');
    }

    if (error.status === 404) {
      return new HttpError(404, 'Google could not find the requested Search Console property.');
    }

    if (error.status === 429) {
      return new HttpError(429, 'Google rate limited the request. Try again shortly.');
    }

    return new HttpError(502, error.message);
  }

  return new HttpError(502, error instanceof Error ? error.message : 'Google request failed.');
}

export async function getSearchConsoleProperties(
  req: Request,
  res: Response<{ success: true; data: SearchConsoleProperty[] }>,
  next: NextFunction,
): Promise<void> {
  try {
    // Identity comes from the session only, so a user can only ever act
    // through their own Google connection.
    const userId = authenticatedUser(req).id;

    const accessToken = await getValidAccessToken(userId);
    const properties = await listProperties(accessToken);

    res.status(200).json({ success: true, data: properties });
  } catch (error) {
    next(toHttpError(error));
  }
}

function readInspectBody(body: unknown): { inspectionUrl: string; siteUrl: string; urlId: string | null } {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  const { inspectionUrl, siteUrl, urlId } = body as Record<string, unknown>;

  if (typeof inspectionUrl !== 'string' || inspectionUrl.trim() === '') {
    throw new HttpError(400, '"inspectionUrl" is required and must be a non-empty string.');
  }

  if (typeof siteUrl !== 'string' || siteUrl.trim() === '') {
    throw new HttpError(400, '"siteUrl" is required and must be a non-empty string.');
  }

  return {
    inspectionUrl: inspectionUrl.trim(),
    siteUrl: siteUrl.trim(),
    urlId: typeof urlId === 'string' && urlId.trim() !== '' ? urlId.trim() : null,
  };
}

/**
 * Resolves which URL records may receive a Google result.
 *
 * Scoped to the caller's own projects. With a urlId, that record must exist in
 * one of those projects (404 otherwise, never 403, so ids cannot be probed) and
 * must be the URL being inspected. Without one, every matching URL in the
 * caller's projects is updated, and nothing belonging to anyone else.
 */
async function resolveOwnedTargets(
  userId: string,
  urlId: string | null,
  normalized: string,
): Promise<Types.ObjectId[]> {
  const projects = await Project.find({ userId: new Types.ObjectId(userId) }).select('_id');
  const projectIds = projects.map((project) => project._id);

  if (urlId !== null) {
    if (!Types.ObjectId.isValid(urlId)) {
      throw new HttpError(400, '"urlId" is not a valid MongoDB ObjectId.');
    }

    const owned = await Url.findOne({ _id: urlId, projectId: { $in: projectIds } }).select('_id url');

    if (owned === null) {
      throw new HttpError(404, 'URL not found.');
    }

    if (owned.url !== normalized) {
      throw new HttpError(400, '"inspectionUrl" does not match the stored URL for "urlId".');
    }

    return [owned._id];
  }

  const matches = await Url.find({ url: normalized, projectId: { $in: projectIds } }).select('_id');

  return matches.map((match) => match._id);
}

/**
 * Inspects one URL with Google's official URL Inspection API.
 *
 * The URL is validated and normalized with the shared utility, then sent to
 * Google as a request *parameter*. This server never fetches the URL here, so
 * this endpoint is not a network egress path for user input.
 */
export async function inspectWithSearchConsole(
  req: Request,
  res: Response<{ success: true; data: GoogleInspectionSnapshot }>,
  next: NextFunction,
): Promise<void> {
  try {
    // Identity comes from the session only, so a user can only ever act
    // through their own Google connection.
    const userId = authenticatedUser(req).id;

    const { inspectionUrl, siteUrl, urlId } = readInspectBody(req.body);

    let normalized: string;

    try {
      normalized = normalizeUrl(inspectionUrl);
    } catch (error) {
      throw error instanceof UrlValidationError ? new HttpError(400, error.message) : error;
    }

    if (!normalized.startsWith('https://')) {
      throw new HttpError(400, 'Google URL inspection requires an HTTPS URL.');
    }

    // Where the result may be stored is resolved BEFORE any Google call: only URL
    // records in the caller's own projects are eligible, never another user's.
    const targets = await resolveOwnedTargets(userId, urlId, normalized);

    const accessToken = await getValidAccessToken(userId);

    // The property must be one this Google account actually holds; an arbitrary
    // siteUrl is never forwarded to Google.
    const properties = await listProperties(accessToken);
    const property = properties.find((entry) => entry.siteUrl === siteUrl);

    if (property === undefined) {
      throw new HttpError(
        403,
        'The connected Google account does not have access to that Search Console property.',
      );
    }

    if (!urlBelongsToProperty(normalized, property.siteUrl)) {
      throw new HttpError(400, `"${normalized}" does not belong to property "${property.siteUrl}".`);
    }

    const snapshot = await inspectUrlWithGoogle(accessToken, normalized, property.siteUrl);

    // Persist onto the caller's own matching URL records. Google's result lives
    // in its own field and never changes `status` or any IndexNow field.
    if (targets.length > 0) {
      await Url.updateMany(
        { _id: { $in: targets } },
        {
          $set: {
            googleInspection: {
              ...snapshot,
              inspectedAt: new Date(snapshot.inspectedAt),
            },
          },
        },
      );
    }

    res.status(200).json({ success: true, data: snapshot });
  } catch (error) {
    next(toHttpError(error));
  }
}
