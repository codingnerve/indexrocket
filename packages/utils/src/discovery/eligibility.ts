import { hostMatchesDomain, hostOfUrl } from '../url/host.js';

/** Milliseconds a URL stays "recently notified" and is not notified again. */
export const DISCOVERY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** HTTP statuses that describe a page that exists and can be announced. */
function isAddedOrUpdated(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Statuses that describe a removed page. IndexNow explicitly supports announcing
 * deletions, so these are notifiable too.
 */
function isRemoved(status: number): boolean {
  return status === 404 || status === 410;
}

export interface DiscoveryCandidate {
  status: string;
  httpStatus: number | null;
  url: string;
  indexNowStatus: string | null;
  indexNowSubmittedAt: Date | null;
}

export interface DiscoveryProjectContext {
  domain: string;
  hasIndexNowKey: boolean;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason: string;
}

/**
 * Decides whether a URL may be announced to a discovery provider.
 *
 * Deliberate decisions:
 *
 * - Only `inspected` URLs qualify. A URL whose inspection failed (invalid URL,
 *   SSRF rejection, DNS failure, timeout) is never notified: we have no evidence
 *   it is a real, reachable, public page.
 * - 2xx means added/updated; 404 and 410 mean removed. Both are legitimate
 *   IndexNow notifications. Everything else (3xx dead ends, 5xx, unknown) is not
 *   announced, because the page's true state is not established.
 * - robots.txt is NOT used as a gate. Our robots result is evaluated for the
 *   `IndexRocketBot` token only, which says nothing about whether search engines
 *   may crawl the URL; using it here would infer the wrong thing.
 * - A recently accepted notification is skipped for {@link DISCOVERY_COOLDOWN_MS}
 *   so repeated requests cannot turn into provider spam.
 */
export function evaluateDiscoveryEligibility(
  candidate: DiscoveryCandidate,
  project: DiscoveryProjectContext,
  now: Date = new Date(),
): EligibilityVerdict {
  if (!project.hasIndexNowKey) {
    return { eligible: false, reason: 'The project has no IndexNow key configured.' };
  }

  if (candidate.status !== 'inspected') {
    return {
      eligible: false,
      reason: `URL status is "${candidate.status}"; only inspected URLs can be announced.`,
    };
  }

  const host = hostOfUrl(candidate.url);

  if (host === null) {
    return { eligible: false, reason: 'The stored URL could not be parsed.' };
  }

  if (!hostMatchesDomain(host, project.domain)) {
    return {
      eligible: false,
      reason: `Host "${host}" does not belong to project domain "${project.domain}".`,
    };
  }

  const httpStatus = candidate.httpStatus;

  if (httpStatus === null) {
    return { eligible: false, reason: 'The URL has no recorded HTTP status.' };
  }

  if (!isAddedOrUpdated(httpStatus) && !isRemoved(httpStatus)) {
    return {
      eligible: false,
      reason: `HTTP status ${httpStatus} is not announceable; only 2xx, 404 and 410 are.`,
    };
  }

  if (candidate.indexNowStatus === 'accepted' && candidate.indexNowSubmittedAt !== null) {
    const elapsed = now.getTime() - candidate.indexNowSubmittedAt.getTime();

    if (elapsed < DISCOVERY_COOLDOWN_MS) {
      const hours = Math.ceil((DISCOVERY_COOLDOWN_MS - elapsed) / 3_600_000);

      return {
        eligible: false,
        reason: `Already notified recently; retry in about ${hours}h.`,
      };
    }
  }

  return { eligible: true, reason: 'Eligible for discovery notification.' };
}
