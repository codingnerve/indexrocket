import type { SitemapInspection } from '@indexrocket/types';
import { tryNormalizeUrl } from '@indexrocket/utils';
import { XMLParser } from 'fast-xml-parser';

import { INSPECTOR_LIMITS } from '../config/limits.js';
import { safeFetch } from './httpInspector.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  // Sitemaps sometimes namespace their elements; strip the prefix so <ns:loc> matches.
  transformTagName: (tag) => tag.replace(/^.*:/, '').toLowerCase(),
});

interface SitemapDocument {
  /** <loc> values from a <urlset>. */
  pageLocations: string[];
  /** <loc> values from a <sitemapindex>. */
  childLocations: string[];
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readLocations(entries: unknown[]): string[] {
  const locations: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const loc = (entry as { loc?: unknown }).loc;

    if (typeof loc === 'string' && loc.trim() !== '') {
      locations.push(loc.trim());
    } else if (typeof loc === 'number') {
      locations.push(String(loc));
    }
  }

  return locations;
}

export function parseSitemap(xml: string): SitemapDocument {
  const parsed: unknown = parser.parse(xml);

  if (typeof parsed !== 'object' || parsed === null) {
    return { pageLocations: [], childLocations: [] };
  }

  const root = parsed as Record<string, unknown>;
  const urlset = root['urlset'];
  const sitemapindex = root['sitemapindex'];

  const pageLocations =
    typeof urlset === 'object' && urlset !== null
      ? readLocations(toArray((urlset as { url?: unknown }).url))
      : [];

  const childLocations =
    typeof sitemapindex === 'object' && sitemapindex !== null
      ? readLocations(toArray((sitemapindex as { sitemap?: unknown }).sitemap))
      : [];

  return { pageLocations, childLocations };
}

async function fetchSitemap(url: string): Promise<SitemapDocument | null> {
  try {
    const response = await safeFetch(url, {
      timeoutMS: INSPECTOR_LIMITS.sitemapTimeoutMS,
      maxBytes: INSPECTOR_LIMITS.sitemapMaxBytes,
      accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
    });

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    // A soft-404 often answers 200 with an HTML page, so the body must actually
    // declare a sitemap root before it is treated as one.
    const head = response.body.subarray(0, 4096).toString('utf8').toLowerCase();

    if (!head.includes('<urlset') && !head.includes('<sitemapindex')) {
      return null;
    }

    return parseSitemap(response.body.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Looks for the target URL in the site's sitemaps.
 *
 * Candidates are the sitemaps advertised in robots.txt followed by the two
 * conventional locations. Traversal is bounded by {@link INSPECTOR_LIMITS}: a
 * capped number of documents, one level of <sitemapindex> children, and a ceiling
 * on the number of <loc> entries examined. This is an inspector, not a crawler.
 */
export async function inspectSitemap(
  target: URL,
  robotsSitemaps: readonly string[],
): Promise<SitemapInspection> {
  const normalizedTarget = tryNormalizeUrl(target.toString());

  const candidates: string[] = [
    ...robotsSitemaps,
    new URL('/sitemap.xml', target.origin).toString(),
    new URL('/sitemap_index.xml', target.origin).toString(),
  ];

  const seen = new Set<string>();
  let fetches = 0;
  let entriesScanned = 0;
  let firstFound: string | null = null;

  const queue: string[] = [];

  for (const candidate of candidates) {
    const normalized = tryNormalizeUrl(candidate);

    if (normalized !== null && !seen.has(normalized)) {
      seen.add(normalized);
      queue.push(normalized);
    }
  }

  let childrenFollowed = 0;

  while (queue.length > 0 && fetches < INSPECTOR_LIMITS.maxSitemapFetches) {
    const next = queue.shift();

    if (next === undefined) {
      break;
    }

    fetches += 1;

    const document = await fetchSitemap(next);

    if (document === null) {
      continue;
    }

    if (firstFound === null) {
      firstFound = next;
    }

    for (const location of document.pageLocations) {
      entriesScanned += 1;

      if (entriesScanned > INSPECTOR_LIMITS.maxSitemapEntries) {
        return { found: true, sitemapUrl: firstFound, urlInSitemap: null };
      }

      if (normalizedTarget !== null && tryNormalizeUrl(location) === normalizedTarget) {
        return { found: true, sitemapUrl: next, urlInSitemap: true };
      }
    }

    for (const child of document.childLocations) {
      if (childrenFollowed >= INSPECTOR_LIMITS.maxSitemapIndexChildren) {
        break;
      }

      const normalized = tryNormalizeUrl(child);

      if (normalized !== null && !seen.has(normalized)) {
        seen.add(normalized);
        queue.push(normalized);
        childrenFollowed += 1;
      }
    }
  }

  if (firstFound === null) {
    return { found: false, sitemapUrl: null, urlInSitemap: null };
  }

  // Every reachable sitemap was read within the limits and the URL was not listed.
  const exhausted = queue.length > 0;

  return { found: true, sitemapUrl: firstFound, urlInSitemap: exhausted ? null : false };
}
