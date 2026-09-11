import type { GoogleInspectionSnapshot, GoogleInspectionStatus, SearchConsoleProperty } from '@indexrocket/types';

import { describeGoogleError, googleRequest, GoogleHttpError } from './httpClient.js';

const SITES_ENDPOINT = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const INSPECT_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

interface SitesResponse {
  siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
}

export async function listProperties(accessToken: string): Promise<SearchConsoleProperty[]> {
  const response = await googleRequest(SITES_ENDPOINT, { method: 'GET', accessToken });

  if (response.status !== 200) {
    throw new GoogleHttpError(
      describeGoogleError(response.status, response.body),
      response.status,
      response.body,
    );
  }

  const parsed = JSON.parse(response.body) as SitesResponse;

  return (parsed.siteEntry ?? [])
    .filter((entry): entry is { siteUrl: string; permissionLevel?: string } => typeof entry.siteUrl === 'string')
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel ?? 'unknown',
    }));
}

interface InspectionApiResponse {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      sitemap?: string[];
      referringUrls?: string[];
      crawledAs?: string;
    };
    mobileUsabilityResult?: { verdict?: string };
    richResultsResult?: { verdict?: string };
  };
}

/**
 * Maps Google's own fields to our status. Nothing is inferred beyond what Google
 * states: `indexed` requires Google to report the URL is on Google.
 *
 * Google's coverageState for an indexed URL reads like "Submitted and indexed"
 * or "Indexed, not submitted in sitemap". A PASS verdict means the URL is on
 * Google. Anything else is reported as not_indexed or unknown — never as indexed.
 */
export function mapInspectionStatus(
  verdict: string | null,
  coverageState: string | null,
): GoogleInspectionStatus {
  if (verdict === 'PASS') {
    return 'indexed';
  }

  if (verdict === 'FAIL' || verdict === 'PARTIAL' || verdict === 'NEUTRAL') {
    // Google explicitly evaluated the URL and did not report it as on Google.
    const coverage = coverageState?.toLowerCase() ?? '';

    if (coverage.includes('indexed') && !coverage.includes('not indexed')) {
      // Google says indexed while the overall verdict is not PASS; report the
      // ambiguity rather than resolving it in either direction.
      return 'unknown';
    }

    return 'not_indexed';
  }

  return 'unknown';
}

export async function inspectUrlWithGoogle(
  accessToken: string,
  inspectionUrl: string,
  siteUrl: string,
): Promise<GoogleInspectionSnapshot> {
  const response = await googleRequest(INSPECT_ENDPOINT, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ inspectionUrl, siteUrl }),
    contentType: 'application/json',
  });

  if (response.status !== 200) {
    throw new GoogleHttpError(
      describeGoogleError(response.status, response.body),
      response.status,
      response.body,
    );
  }

  const parsed = JSON.parse(response.body) as InspectionApiResponse;
  const result = parsed.inspectionResult ?? {};
  const index = result.indexStatusResult ?? {};

  const verdict = index.verdict ?? null;
  const coverageState = index.coverageState ?? null;

  return {
    status: mapInspectionStatus(verdict, coverageState),
    verdict,
    coverageState,
    indexingState: index.indexingState ?? null,
    robotsTxtState: index.robotsTxtState ?? null,
    pageFetchState: index.pageFetchState ?? null,
    lastCrawlTime: index.lastCrawlTime ?? null,
    crawledAs: index.crawledAs ?? null,
    googleCanonical: index.googleCanonical ?? null,
    userCanonical: index.userCanonical ?? null,
    sitemaps: index.sitemap ?? [],
    referringUrls: index.referringUrls ?? [],
    mobileUsabilityVerdict: result.mobileUsabilityResult?.verdict ?? null,
    richResultsVerdict: result.richResultsResult?.verdict ?? null,
    siteUrl,
    inspectionResultLink: result.inspectionResultLink ?? null,
    inspectedAt: new Date().toISOString(),
    error: null,
  };
}

/**
 * Search Console properties come in two shapes: a URL-prefix property
 * ("https://example.com/") and a domain property ("sc-domain:example.com").
 * A URL belongs to a prefix property when it starts with that prefix, and to a
 * domain property when its hostname is that domain or a subdomain of it.
 */
export function urlBelongsToProperty(inspectionUrl: string, siteUrl: string): boolean {
  if (siteUrl.startsWith('sc-domain:')) {
    const domain = siteUrl.slice('sc-domain:'.length).toLowerCase();

    try {
      const host = new URL(inspectionUrl).hostname.toLowerCase();

      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }

  return inspectionUrl.startsWith(siteUrl);
}
