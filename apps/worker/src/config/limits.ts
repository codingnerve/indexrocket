/**
 * The inspector identifies itself honestly. It never impersonates a search engine
 * crawler, and robots.txt rules are evaluated for exactly this token.
 */
export const USER_AGENT_TOKEN = 'IndexRocketBot';

export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+https://indexrocket.local/bot)`;

/**
 * Hard limits that keep the worker an inspector rather than a crawler.
 * Every outbound request is bounded in time and in bytes.
 */
export const INSPECTOR_LIMITS = {
  /** Per-request timeout for the inspected page. */
  httpTimeoutMS: 10_000,
  /** Redirect hops followed before the inspection gives up. */
  maxRedirects: 5,
  /** Bytes read from the inspected page before the transfer is cut. */
  maxResponseBytes: 2 * 1024 * 1024,

  /** robots.txt is small by definition; anything larger is ignored. */
  robotsTimeoutMS: 5_000,
  robotsMaxBytes: 512 * 1024,

  /** Sitemap traversal is deliberately shallow and bounded. */
  sitemapTimeoutMS: 10_000,
  sitemapMaxBytes: 5 * 1024 * 1024,
  /** Candidate sitemap documents fetched in total (index children included). */
  maxSitemapFetches: 6,
  /** Child sitemaps followed from a <sitemapindex>. */
  maxSitemapIndexChildren: 3,
  /** <loc> entries examined across the whole traversal. */
  maxSitemapEntries: 50_000,
  /** Sitemap URLs read from robots.txt. */
  maxRobotsSitemaps: 3,
} as const;

/**
 * Limits for outbound discovery notifications. Conservative on purpose: this is a
 * notification channel to third-party search engines, not a bulk pipe.
 */
export const DISCOVERY_LIMITS = {
  /** URLs per notification. The protocol allows far more; we stay small. */
  maxUrlsPerNotification: 100,
  /** Timeout for the notification request itself. */
  notifyTimeoutMS: 15_000,
  /** Bytes read from the provider response. */
  notifyMaxResponseBytes: 64 * 1024,
  /** Notifications must not be redirected; a redirect is treated as a failure. */
  notifyMaxRedirects: 0,

  /** Key file verification. */
  keyVerificationTimeoutMS: 8_000,
  keyFileMaxBytes: 4 * 1024,
  keyFileMaxRedirects: 1,
} as const;
