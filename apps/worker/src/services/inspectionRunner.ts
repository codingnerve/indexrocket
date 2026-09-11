import { Url, type UrlDocument } from '@indexrocket/database';
import { SsrfBlockedError, UrlValidationError } from '@indexrocket/utils';
import type { HydratedDocument } from 'mongoose';

import { inspectUrl } from './urlInspector.js';

export interface InspectionOutcome {
  ok: boolean;
  /** True when the failure cannot succeed on retry (bad URL, blocked host). */
  permanent: boolean;
  message: string;
  document: HydratedDocument<UrlDocument> | null;
  summary: string[];
}

/**
 * Failures are summarised for storage. Internal details (stack traces, resolved
 * addresses of internal hosts) never reach the stored record.
 */
function describeFailure(error: unknown): { message: string; permanent: boolean } {
  if (error instanceof UrlValidationError || error instanceof SsrfBlockedError) {
    return { message: error.message, permanent: true };
  }

  if (error instanceof Error) {
    return { message: error.message.slice(0, 300), permanent: false };
  }

  return { message: 'URL inspection failed for an unknown reason.', permanent: false };
}

/**
 * Inspects one URL and persists the result.
 *
 * This is the single implementation used by BOTH the interactive inspection
 * processor and the bulk submission processor, so a URL inspected inside a batch
 * is measured and stored exactly the same way as one inspected on its own.
 *
 * It writes only inspection fields. It never touches IndexNow state or
 * `googleInspection`, and it never writes `status: 'indexed'`.
 */
export async function runInspection(urlId: string, url: string): Promise<InspectionOutcome> {
  await Url.updateOne({ _id: urlId }, { $set: { status: 'processing' } });

  try {
    const result = await inspectUrl(url);
    const now = new Date();

    const summary = [
      `HTTP: ${result.http.status ?? 'n/a'}`,
      `Canonical: ${result.canonical.type}`,
      `Robots: ${result.robots.allowed === null ? 'unknown' : result.robots.allowed ? 'allowed' : 'disallowed'}`,
      `Sitemap: ${result.sitemap.found ? 'found' : 'not found'}`,
      `In sitemap: ${result.sitemap.urlInSitemap === null ? 'unknown' : String(result.sitemap.urlInSitemap)}`,
    ];

    const document = await Url.findOneAndUpdate(
      { _id: urlId },
      {
        $set: {
          // "inspected" describes the processing stage only; it is not an
          // assertion that any search engine has indexed this URL.
          status: 'inspected',
          normalizedUrl: result.normalizedUrl,
          httpStatus: result.http.status,
          finalUrl: result.http.finalUrl,
          contentType: result.http.contentType,
          responseTimeMs: result.http.responseTimeMs,
          redirectCount: result.http.redirectCount,
          robotsReachable: result.robots.reachable,
          robotsAllowed: result.robots.allowed,
          robotsUserAgent: result.robots.userAgent,
          canonical: result.canonical.value,
          canonicalType: result.canonical.type,
          sitemapFound: result.sitemap.found,
          sitemapUrl: result.sitemap.sitemapUrl,
          urlInSitemap: result.sitemap.urlInSitemap,
          lastInspectedAt: now,
          lastCheckedAt: now,
          inspectionError: null,
        },
      },
      { returnDocument: 'after' },
    );

    return { ok: true, permanent: false, message: 'Inspected.', document, summary };
  } catch (error) {
    const { message, permanent } = describeFailure(error);

    await Url.updateOne(
      { _id: urlId },
      { $set: { status: 'failed', inspectionError: message, lastCheckedAt: new Date() } },
    );

    return { ok: false, permanent, message, document: null, summary: [] };
  }
}
