/**
 * Response shapes of the IndexRocket API, as the frontend consumes them.
 *
 * Source of truth (keep in sync):
 *   - auth:      apps/api/src/controllers/auth.controller.ts (PublicUser)
 *   - projects:  apps/api/src/controllers/project.controller.ts (ProjectView, ProjectSummary)
 *   - URLs:      apps/api/src/services/urlView.ts (UrlView)
 *   - batches:   apps/api/src/controllers/batch.controller.ts (BatchView, item view)
 *   - Google:    packages/types/src/google.ts
 *   - IndexNow:  packages/types/src/discovery.ts
 *   - enums:     packages/database/src/models/*.ts
 *
 * They are mirrored rather than imported so the web app builds on its own; the
 * project, URL and batch views are defined inside the API, not in a shared
 * package.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  credits: number;
  /** Computed by the API from the stored role. Display only; the API enforces it. */
  unlimitedCredits: boolean;
}

export interface Project {
  id: string;
  name: string;
  domain: string;
  /** Whether an IndexNow key is configured. The key itself is never returned. */
  hasIndexNowKey: boolean;
  indexNowKeyLocation: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Three independent status families, counted from three different fields. */
export interface ProjectSummary {
  totalUrls: number;
  /** Our own inspection stage (Url.status). */
  inspection: { pending: number; inspected: number; failed: number };
  /** What Google Search Console reported. The only source for "indexed". */
  google: { indexed: number; notIndexed: number; unknown: number; notInspected: number };
  /** Whether an IndexNow notification was accepted. Never evidence of indexing. */
  indexNow: { accepted: number; failed: number; pending: number; notSubmitted: number };
}

/** Url.status values. The inspection pipeline sets queued/processing/inspected/failed. */
export type UrlStatus =
  | 'queued'
  | 'processing'
  | 'inspected'
  | 'submitted'
  | 'discovery'
  | 'crawled'
  | 'indexed'
  | 'not_indexed'
  | 'failed'
  | 'unknown';

/** Values the URL list filter accepts and the pipeline actually produces. */
export const URL_STATUS_FILTERS = ['queued', 'processing', 'inspected', 'failed'] as const;

export type IndexNowStatus = 'not_submitted' | 'pending' | 'accepted' | 'failed';
export type GoogleInspectionStatus = 'indexed' | 'not_indexed' | 'unknown' | 'error';
export type CanonicalType = 'self' | 'different' | 'missing' | 'invalid';

export interface GoogleInspectionView {
  status: GoogleInspectionStatus | string;
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
  status: UrlStatus | string;

  httpStatus: number | null;
  finalUrl: string | null;
  contentType: string | null;
  responseTimeMs: number | null;
  redirectCount: number | null;

  robotsReachable: boolean | null;
  robotsAllowed: boolean | null;
  robotsUserAgent: string | null;

  canonical: string | null;
  canonicalType: CanonicalType | string | null;

  sitemapFound: boolean | null;
  sitemapUrl: string | null;
  urlInSitemap: boolean | null;

  error: string | null;

  submittedAt: string | null;
  crawledAt: string | null;
  indexedAt: string | null;
  lastCheckedAt: string | null;
  lastInspectedAt: string | null;

  discovery: {
    indexNow: {
      status: IndexNowStatus | string;
      submittedAt: string | null;
      responseCode: number | null;
      lastError: string | null;
    };
  };
  googleInspection: GoogleInspectionView | null;

  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  success: boolean;
  data: T[];
  pagination: Pagination;
}

export interface ApiData<T> {
  success: boolean;
  data: T;
}

export type BatchStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export const TERMINAL_BATCH_STATUSES: readonly string[] = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
];

export type BatchItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
export const BATCH_ITEM_STATUS_FILTERS = ['pending', 'processing', 'completed', 'failed', 'skipped'] as const;

export type StageOutcome = 'not_run' | 'skipped' | 'succeeded' | 'failed';

export interface Batch {
  id: string;
  projectId: string;
  status: BatchStatus | string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  inspectGoogle: boolean;
  googleSiteUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface BatchItem {
  id: string;
  urlId: string;
  url: string;
  status: BatchItemStatus | string;
  inspectionStatus: StageOutcome | string;
  discoveryStatus: StageOutcome | string;
  googleStatus: StageOutcome | string;
  errorCode: string | null;
  errorMessage: string | null;
  notes: string[];
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateBatchResponse {
  success: boolean;
  data: Batch;
  summary: { requested: number; deduplicated: number; alreadyInFlight: number; queued: number };
}

export interface BulkImportResponse {
  success: boolean;
  summary: { submitted: number; created: number; duplicates: number; rejected: number };
  results: Array<{ url: string; status: 'created' | 'duplicate' | 'rejected'; reason?: string; id?: string }>;
}

export interface AddUrlResponse {
  success: boolean;
  created: boolean;
  data: UrlView;
}

export interface InspectResponse {
  success: boolean;
  message: string;
  urlId: string;
  jobId: string;
  url: string;
}

export interface GoogleConnection {
  connected: boolean;
  status: 'connected' | 'expired' | 'revoked' | 'error' | null;
  googleAccountId: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
}

export interface SearchConsoleProperty {
  siteUrl: string;
  permissionLevel: string;
}

/** Normalized subset of Google's URL Inspection response. Nothing is inferred. */
export interface GoogleInspectionSnapshot {
  status: GoogleInspectionStatus | string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  sitemaps: string[];
  referringUrls: string[];
  mobileUsabilityVerdict: string | null;
  richResultsVerdict: string | null;
  siteUrl: string | null;
  inspectionResultLink: string | null;
  inspectedAt: string;
  error: string | null;
}
