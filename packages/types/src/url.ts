/** Payload carried on the BullMQ queue for one URL inspection. */
export interface UrlInspectionJobData {
  urlId: string;
  projectId: string;
  url: string;
}

export type CanonicalType = 'self' | 'different' | 'missing' | 'invalid';

export interface HttpInspection {
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  responseTimeMs: number | null;
  redirectCount: number;
}

export interface RobotsInspection {
  /** True when robots.txt returned any HTTP response, including 404. */
  reachable: boolean;
  /** True when a robots.txt document was actually served (HTTP 2xx). */
  exists: boolean;
  /** null when robots.txt could not be evaluated, so the signal is unknown. */
  allowed: boolean | null;
  /** The user-agent token these rules were evaluated for. */
  userAgent: string;
  /** Sitemap URLs advertised by robots.txt, capped by the inspector limits. */
  sitemaps: string[];
}

export interface CanonicalInspection {
  value: string | null;
  type: CanonicalType;
}

export interface SitemapInspection {
  found: boolean;
  sitemapUrl: string | null;
  /** null when no sitemap could be read, so membership is unknown. */
  urlInSitemap: boolean | null;
}

/**
 * The result of inspecting one URL. These are processing/inspection signals only:
 * nothing here asserts that a search engine has indexed the URL.
 */
export interface UrlInspectionResult {
  url: string;
  normalizedUrl: string;
  http: HttpInspection;
  robots: RobotsInspection;
  canonical: CanonicalInspection;
  sitemap: SitemapInspection;
  inspectedAt: string;
}

/** Result returned to BullMQ when a job finishes. */
export interface UrlInspectionJobResult {
  success: boolean;
  urlId: string;
  url: string;
  httpStatus: number | null;
  inspectedAt: string;
}
