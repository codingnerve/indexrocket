/**
 * Google Search Console integration types.
 *
 * Google's URL Inspection API is the only source in this system that can speak to
 * whether Google has indexed a URL. It is a separate concept from our own
 * inspection (what WE observed) and from an IndexNow acceptance (that a
 * notification was received). See docs/DISCOVERY.md.
 */
export type GoogleConnectionStatus = 'connected' | 'expired' | 'revoked' | 'error';

/**
 * indexed     - Google reports the URL is on Google
 * not_indexed - Google reports it is not on Google
 * unknown     - Google returned a verdict we cannot map with confidence
 * error       - the inspection could not be completed
 */
export type GoogleInspectionStatus = 'indexed' | 'not_indexed' | 'unknown' | 'error';

export interface SearchConsoleProperty {
  siteUrl: string;
  permissionLevel: string;
}

/**
 * Normalized subset of Google's urlInspection response. Every field mirrors
 * something Google actually returned; nothing here is inferred or invented.
 */
export interface GoogleInspectionSnapshot {
  status: GoogleInspectionStatus;
  /** Google's own verdict string: PASS, PARTIAL, FAIL, NEUTRAL or VERDICT_UNSPECIFIED. */
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
  /** The Search Console property the inspection was run against. */
  siteUrl: string | null;
  /** Link to the same report inside Search Console, when Google provides one. */
  inspectionResultLink: string | null;
  inspectedAt: string;
  error: string | null;
}

export interface GoogleConnectionView {
  connected: boolean;
  status: GoogleConnectionStatus | null;
  googleAccountId: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
}
