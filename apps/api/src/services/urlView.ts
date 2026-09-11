import type { UrlDocument } from '@indexrocket/database';
import type { DiscoveryStatusView } from '@indexrocket/types';

export interface GoogleInspectionView {
  status: string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  siteUrl: string | null;
  inspectionResultLink: string | null;
  inspectedAt: string | null;
  error: string | null;
}

export interface UrlView {
  id: string;
  projectId: string;
  url: string;
  normalizedUrl: string | null;
  status: string;

  httpStatus: number | null;
  finalUrl: string | null;
  contentType: string | null;
  responseTimeMs: number | null;
  redirectCount: number | null;

  robotsReachable: boolean | null;
  robotsAllowed: boolean | null;
  robotsUserAgent: string | null;

  canonical: string | null;
  canonicalType: string | null;

  sitemapFound: boolean | null;
  sitemapUrl: string | null;
  urlInSitemap: boolean | null;

  error: string | null;

  submittedAt: string | null;
  crawledAt: string | null;
  indexedAt: string | null;
  lastCheckedAt: string | null;
  lastInspectedAt: string | null;

  discovery: DiscoveryStatusView;
  googleInspection: GoogleInspectionView | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * The single public projection of a URL document.
 *
 * All three status families are exposed side by side and never merged: `status`
 * is our own inspection stage, `discovery.indexNow` is whether a notification
 * was accepted, and `googleInspection` is what Google reported. Nothing secret
 * lives on this document, but keeping one projection means a field added to the
 * model is never leaked by accident from a second, forgotten mapper.
 */
export function toUrlView(document: UrlDocument): UrlView {
  const google = document.googleInspection ?? null;

  return {
    id: document._id.toString(),
    projectId: document.projectId.toString(),
    url: document.url,
    normalizedUrl: document.normalizedUrl ?? null,
    status: document.status,

    httpStatus: document.httpStatus ?? null,
    finalUrl: document.finalUrl ?? null,
    contentType: document.contentType ?? null,
    responseTimeMs: document.responseTimeMs ?? null,
    redirectCount: document.redirectCount ?? null,

    robotsReachable: document.robotsReachable ?? null,
    robotsAllowed: document.robotsAllowed ?? null,
    robotsUserAgent: document.robotsUserAgent ?? null,

    canonical: document.canonical ?? null,
    canonicalType: document.canonicalType ?? null,

    sitemapFound: document.sitemapFound ?? null,
    sitemapUrl: document.sitemapUrl ?? null,
    urlInSitemap: document.urlInSitemap ?? null,

    error: document.inspectionError ?? null,

    submittedAt: document.submittedAt?.toISOString() ?? null,
    crawledAt: document.crawledAt?.toISOString() ?? null,
    indexedAt: document.indexedAt?.toISOString() ?? null,
    lastCheckedAt: document.lastCheckedAt?.toISOString() ?? null,
    lastInspectedAt: document.lastInspectedAt?.toISOString() ?? null,

    discovery: {
      indexNow: {
        status: document.indexNowStatus ?? 'not_submitted',
        submittedAt: document.indexNowSubmittedAt?.toISOString() ?? null,
        responseCode: document.indexNowResponseCode ?? null,
        lastError: document.indexNowLastError ?? null,
      },
    },

    googleInspection:
      google === null
        ? null
        : {
            status: google.status,
            verdict: google.verdict ?? null,
            coverageState: google.coverageState ?? null,
            indexingState: google.indexingState ?? null,
            robotsTxtState: google.robotsTxtState ?? null,
            pageFetchState: google.pageFetchState ?? null,
            lastCrawlTime: google.lastCrawlTime ?? null,
            crawledAs: google.crawledAs ?? null,
            googleCanonical: google.googleCanonical ?? null,
            userCanonical: google.userCanonical ?? null,
            siteUrl: google.siteUrl ?? null,
            inspectionResultLink: google.inspectionResultLink ?? null,
            inspectedAt:
              google.inspectedAt instanceof Date
                ? google.inspectedAt.toISOString()
                : (google.inspectedAt ?? null),
            error: google.error ?? null,
          },

    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
