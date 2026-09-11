import type { UrlInspectionResult } from '@indexrocket/types';
import { assertSafeUrl, parseAndNormalizeUrl } from '@indexrocket/utils';

import { inspectCanonical, isHtmlContentType } from './htmlInspector.js';
import { safeFetch } from './httpInspector.js';
import { inspectRobots } from './robotsChecker.js';
import { inspectSitemap } from './sitemapChecker.js';

/**
 * Inspects one URL and returns processing signals.
 *
 * The HTTP fetch is the critical step: if it fails the inspection fails. The
 * robots, canonical and sitemap signals are optional — when they cannot be
 * determined they come back as `null`/`missing` and the inspection still succeeds.
 */
export async function inspectUrl(rawUrl: string): Promise<UrlInspectionResult> {
  const normalized = parseAndNormalizeUrl(rawUrl);

  // Critical: an unsafe destination stops the inspection before any request.
  await assertSafeUrl(normalized);

  const response = await safeFetch(normalized);
  const finalUrl = response.finalUrl;

  const canonical =
    isHtmlContentType(response.contentType) && response.body.length > 0
      ? inspectCanonical(response.body.toString('utf8'), finalUrl)
      : { value: null, type: 'missing' as const };

  // Optional signals are evaluated against the final URL after redirects.
  const finalTarget = parseAndNormalizeUrl(finalUrl);
  const robots = await inspectRobots(finalTarget);
  const sitemap = await inspectSitemap(finalTarget, robots.sitemaps);

  return {
    url: rawUrl,
    normalizedUrl: normalized.toString(),
    http: {
      status: response.status,
      finalUrl,
      contentType: response.contentType,
      contentLength: response.contentLength,
      responseTimeMs: response.responseTimeMs,
      redirectCount: response.redirectCount,
    },
    robots,
    canonical,
    sitemap,
    inspectedAt: new Date().toISOString(),
  };
}
