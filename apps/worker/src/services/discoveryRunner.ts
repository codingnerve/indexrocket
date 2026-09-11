import { Url, type ProjectDocument, type UrlDocument } from '@indexrocket/database';
import { evaluateDiscoveryEligibility, hostOfUrl } from '@indexrocket/utils';

import { getDiscoveryProvider } from '../providers/registry.js';
import { PermanentProviderError } from '../providers/types.js';

export interface DiscoveryOutcome {
  /** 'notified' only when the provider accepted the notification. */
  result: 'notified' | 'skipped' | 'failed';
  /** True when retrying cannot help (bad key, foreign host, ineligible URL). */
  permanent: boolean;
  message: string;
  statusCode: number | null;
  /** Short machine-readable reason, e.g. "cooldown". */
  code: string | null;
}

async function markFailed(urlIds: string[], statusCode: number | null, error: string): Promise<void> {
  await Url.updateMany(
    { _id: { $in: urlIds } },
    {
      $set: {
        indexNowStatus: 'failed',
        indexNowResponseCode: statusCode,
        indexNowLastError: error.slice(0, 500),
      },
    },
  );
}

/**
 * Notifies IndexNow about one URL and persists the outcome.
 *
 * Shared by the discovery processor and the bulk submission processor so a batch
 * cannot take a shortcut around the guards: eligibility (including the 24-hour
 * cooldown), host match and key verification all run exactly as they do for a
 * single-URL discovery.
 *
 * An accepted notification is recorded as `indexNowStatus: 'accepted'`. That
 * means the provider received it — never that the URL was crawled or indexed.
 */
export async function runDiscovery(
  project: ProjectDocument,
  document: UrlDocument,
): Promise<DiscoveryOutcome> {
  const key = project.indexNowKey ?? null;
  const hasKey = typeof key === 'string' && key.trim() !== '';

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
    // Ineligibility is a normal, terminal outcome, not an error to retry.
    return {
      result: 'skipped',
      permanent: true,
      message: verdict.reason,
      statusCode: null,
      code: verdict.reason.startsWith('Already notified') ? 'cooldown' : 'ineligible',
    };
  }

  const host = hostOfUrl(document.url);

  if (host === null || key === null) {
    return {
      result: 'skipped',
      permanent: true,
      message: 'The URL host or the project key could not be resolved.',
      statusCode: null,
      code: 'ineligible',
    };
  }

  const id = document._id.toString();

  await Url.updateOne({ _id: id }, { $set: { indexNowStatus: 'pending' } });

  try {
    const result = await getDiscoveryProvider('indexnow').notifyUrls({
      host,
      urls: [document.url],
      key,
      keyLocation: project.indexNowKeyLocation ?? null,
    });

    await Url.updateOne(
      { _id: id },
      {
        $set: {
          // "accepted" records that the provider took the notification.
          indexNowStatus: result.accepted ? 'accepted' : 'failed',
          indexNowSubmittedAt: new Date(result.submittedAt),
          indexNowResponseCode: result.statusCode,
          indexNowLastError: result.accepted ? null : result.message,
        },
      },
    );

    if (result.accepted) {
      return {
        result: 'notified',
        permanent: false,
        message: result.message,
        statusCode: result.statusCode,
        code: null,
      };
    }

    // A non-accepted, non-permanent status (429, unexpected) may pass on retry.
    return {
      result: 'failed',
      permanent: false,
      message: result.message,
      statusCode: result.statusCode,
      code: 'provider_rejected',
    };
  } catch (error) {
    const permanent = error instanceof PermanentProviderError;
    const message = error instanceof Error ? error.message : 'Unknown discovery failure.';
    const statusCode = permanent ? error.statusCode : null;

    await markFailed([id], statusCode, message);

    return {
      result: 'failed',
      permanent,
      message,
      statusCode,
      code: permanent ? 'provider_permanent' : 'provider_transient',
    };
  }
}
