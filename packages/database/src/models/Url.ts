import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * Processing states plus the search-engine states reserved for later steps.
 *
 * Inspection only ever sets `queued`, `processing`, `inspected` or `failed`.
 * `indexed`/`not_indexed` are never written from inspection signals: they require
 * evidence from a real indexing-status mechanism.
 */
export const URL_STATUSES = [
  'queued',
  'processing',
  'inspected',
  'submitted',
  'discovery',
  'crawled',
  'indexed',
  'not_indexed',
  'failed',
  'unknown',
] as const;

export type UrlStatus = (typeof URL_STATUSES)[number];

export const INDEXNOW_STATUSES = ['not_submitted', 'pending', 'accepted', 'failed'] as const;
export type IndexNowStatusValue = (typeof INDEXNOW_STATUSES)[number];

export const GOOGLE_INSPECTION_STATUSES = ['indexed', 'not_indexed', 'unknown', 'error'] as const;
export type GoogleInspectionStatusValue = (typeof GOOGLE_INSPECTION_STATUSES)[number];

/**
 * Google's own view of the URL, kept strictly separate from our inspection
 * (`status`) and from IndexNow notification state (`indexNow*`). Only Google may
 * set this, and only from an official URL Inspection API response.
 */
export interface GoogleInspectionSubdocument {
  status: GoogleInspectionStatusValue;
  verdict?: string | null;
  coverageState?: string | null;
  indexingState?: string | null;
  robotsTxtState?: string | null;
  pageFetchState?: string | null;
  lastCrawlTime?: string | null;
  crawledAs?: string | null;
  googleCanonical?: string | null;
  userCanonical?: string | null;
  sitemaps?: string[];
  referringUrls?: string[];
  mobileUsabilityVerdict?: string | null;
  richResultsVerdict?: string | null;
  siteUrl?: string | null;
  inspectionResultLink?: string | null;
  inspectedAt?: Date | null;
  error?: string | null;
}

export const CANONICAL_TYPES = ['self', 'different', 'missing', 'invalid'] as const;
export type CanonicalTypeValue = (typeof CANONICAL_TYPES)[number];

export interface UrlDocument {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  url: string;
  normalizedUrl?: string;
  status: UrlStatus;

  // HTTP inspection
  httpStatus?: number | null;
  finalUrl?: string | null;
  contentType?: string | null;
  responseTimeMs?: number | null;
  redirectCount?: number | null;

  // robots.txt signals
  robotsReachable?: boolean | null;
  robotsAllowed?: boolean | null;
  robotsUserAgent?: string | null;

  // Canonical signals
  canonical?: string | null;
  canonicalType?: CanonicalTypeValue | null;

  // Sitemap signals
  sitemapFound?: boolean | null;
  sitemapUrl?: string | null;
  urlInSitemap?: boolean | null;

  // Discovery (IndexNow). "accepted" means the provider accepted the notification;
  // it is never evidence that the URL was crawled or indexed.
  indexNowStatus?: IndexNowStatusValue;
  indexNowSubmittedAt?: Date | null;
  indexNowResponseCode?: number | null;
  indexNowLastError?: string | null;

  /** Google Search Console inspection. Independent of `status` and of IndexNow state. */
  googleInspection?: GoogleInspectionSubdocument | null;

  inspectionError?: string | null;
  lastInspectedAt?: Date | null;

  // Reserved for the later indexing steps; not written by inspection.
  submittedAt?: Date;
  crawledAt?: Date;
  indexedAt?: Date;
  lastCheckedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const urlSchema = new Schema<UrlDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
    },
    normalizedUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
    },
    status: {
      type: String,
      enum: URL_STATUSES,
      default: 'queued',
      required: true,
    },

    httpStatus: { type: Number, default: null },
    finalUrl: { type: String, trim: true, maxlength: 2048, default: null },
    contentType: { type: String, trim: true, maxlength: 200, default: null },
    responseTimeMs: { type: Number, default: null },
    redirectCount: { type: Number, default: null },

    robotsReachable: { type: Boolean, default: null },
    robotsAllowed: { type: Boolean, default: null },
    robotsUserAgent: { type: String, trim: true, maxlength: 120, default: null },

    canonical: { type: String, trim: true, maxlength: 2048, default: null },
    canonicalType: { type: String, enum: [...CANONICAL_TYPES, null], default: null },

    sitemapFound: { type: Boolean, default: null },
    sitemapUrl: { type: String, trim: true, maxlength: 2048, default: null },
    urlInSitemap: { type: Boolean, default: null },

    indexNowStatus: {
      type: String,
      enum: INDEXNOW_STATUSES,
      default: 'not_submitted',
      required: true,
    },
    indexNowSubmittedAt: { type: Date, default: null },
    indexNowResponseCode: { type: Number, default: null },
    indexNowLastError: { type: String, maxlength: 500, default: null },

    googleInspection: {
      type: new Schema<GoogleInspectionSubdocument>(
        {
          status: { type: String, enum: GOOGLE_INSPECTION_STATUSES, required: true },
          verdict: { type: String, default: null },
          coverageState: { type: String, default: null },
          indexingState: { type: String, default: null },
          robotsTxtState: { type: String, default: null },
          pageFetchState: { type: String, default: null },
          lastCrawlTime: { type: String, default: null },
          crawledAs: { type: String, default: null },
          googleCanonical: { type: String, default: null },
          userCanonical: { type: String, default: null },
          sitemaps: { type: [String], default: [] },
          referringUrls: { type: [String], default: [] },
          mobileUsabilityVerdict: { type: String, default: null },
          richResultsVerdict: { type: String, default: null },
          siteUrl: { type: String, default: null },
          inspectionResultLink: { type: String, default: null },
          inspectedAt: { type: Date, default: null },
          error: { type: String, maxlength: 500, default: null },
        },
        { _id: false },
      ),
      default: null,
    },

    inspectionError: { type: String, maxlength: 500, default: null },
    lastInspectedAt: { type: Date, default: null },

    submittedAt: { type: Date },
    crawledAt: { type: Date },
    indexedAt: { type: Date },
    lastCheckedAt: { type: Date },
  },
  { timestamps: true },
);

// A URL is unique per project, not globally: two projects may legitimately track the same URL.
urlSchema.index({ projectId: 1, url: 1 }, { unique: true });

// Serves status dashboards and future queue pickup ("next queued URLs of a project").
urlSchema.index({ projectId: 1, status: 1 });

// Supports filtering a project's URLs by what Google reported.
urlSchema.index({ projectId: 1, 'googleInspection.status': 1 });

// Serves the paginated project URL table, which sorts newest-first.
urlSchema.index({ projectId: 1, createdAt: -1 });

// Serves IndexNow status filtering and the project summary's discovery counts.
urlSchema.index({ projectId: 1, indexNowStatus: 1 });

export const Url: Model<UrlDocument> = model<UrlDocument>('Url', urlSchema);
