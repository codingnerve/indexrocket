import type { CanonicalInspection } from '@indexrocket/types';
import { normalizeUrl } from '@indexrocket/utils';
import * as cheerio from 'cheerio';

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

export function isHtmlContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return HTML_CONTENT_TYPES.includes(essence);
}

/**
 * Extracts `<link rel="canonical">` and classifies it against the page's own URL.
 *
 * A canonical tag is a hint about the preferred URL. It says nothing about whether
 * a search engine has indexed the page.
 */
export function inspectCanonical(html: string, finalUrl: string): CanonicalInspection {
  const $ = cheerio.load(html);

  // rel can carry several space-separated tokens, e.g. rel="canonical alternate".
  const link = $('link[rel]')
    .toArray()
    .find((element) => {
      const rel = $(element).attr('rel') ?? '';

      return rel
        .toLowerCase()
        .split(/\s+/)
        .includes('canonical');
    });

  if (link === undefined) {
    return { value: null, type: 'missing' };
  }

  const href = $(link).attr('href')?.trim();

  if (href === undefined || href === '') {
    return { value: null, type: 'invalid' };
  }

  let resolved: string;

  try {
    // Canonical hrefs are commonly relative and must resolve against the final URL.
    resolved = normalizeUrl(new URL(href, finalUrl).toString());
  } catch {
    return { value: href, type: 'invalid' };
  }

  let self: string;

  try {
    self = normalizeUrl(finalUrl);
  } catch {
    return { value: resolved, type: 'different' };
  }

  return { value: resolved, type: resolved === self ? 'self' : 'different' };
}
