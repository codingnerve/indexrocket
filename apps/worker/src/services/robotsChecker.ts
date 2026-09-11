import type { RobotsInspection } from '@indexrocket/types';

import { INSPECTOR_LIMITS, USER_AGENT_TOKEN } from '../config/limits.js';
import { safeFetch } from './httpInspector.js';

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/**
 * Parses robots.txt into user-agent groups plus any advertised sitemaps.
 * Comments are stripped and unknown directives are ignored.
 */
export function parseRobotsTxt(content: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];

  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one rule block.
  let acceptingAgents = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';

    if (line === '') {
      continue;
    }

    const separator = line.indexOf(':');

    if (separator === -1) {
      continue;
    }

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (current === null || !acceptingAgents) {
          current = { agents: [], rules: [] };
          groups.push(current);
          acceptingAgents = true;
        }

        current.agents.push(value.toLowerCase());
        break;
      }

      case 'allow':
      case 'disallow': {
        if (current === null) {
          break;
        }

        acceptingAgents = false;
        current.rules.push({ allow: field === 'allow', pattern: value });
        break;
      }

      case 'sitemap': {
        if (value !== '' && sitemaps.length < INSPECTOR_LIMITS.maxRobotsSitemaps) {
          sitemaps.push(value);
        }
        break;
      }

      default:
        break;
    }
  }

  return { groups, sitemaps };
}

/** Selects the group for our token, falling back to the wildcard group. */
function selectGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | null {
  const token = userAgent.toLowerCase();
  let best: { group: RobotsGroup; length: number } | null = null;

  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        continue;
      }

      // Longest matching agent prefix wins, per the robots exclusion protocol.
      if (token.startsWith(agent) && (best === null || agent.length > best.length)) {
        best = { group, length: agent.length };
      }
    }
  }

  if (best !== null) {
    return best.group;
  }

  return groups.find((group) => group.agents.includes('*')) ?? null;
}

/** Translates a robots path pattern (`*` wildcard, `$` end anchor) into a regex. */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

/**
 * Applies a robots group to a path.
 *
 * Longest matching pattern wins; Allow wins an exact-length tie. An empty
 * Disallow value means "allow everything" and is skipped.
 */
export function isPathAllowed(group: RobotsGroup | null, path: string): boolean {
  if (group === null) {
    return true;
  }

  let decision: { allow: boolean; length: number } | null = null;

  for (const rule of group.rules) {
    if (rule.pattern === '') {
      continue;
    }

    if (!patternToRegExp(rule.pattern).test(path)) {
      continue;
    }

    const length = rule.pattern.length;

    if (
      decision === null ||
      length > decision.length ||
      (length === decision.length && rule.allow)
    ) {
      decision = { allow: rule.allow, length };
    }
  }

  return decision?.allow ?? true;
}

/**
 * Fetches and evaluates robots.txt for the target URL.
 *
 * Rules are evaluated for the `IndexRocketBot` token only. This is a good-faith
 * reading of the robots exclusion protocol, not a reproduction of any particular
 * search engine's crawler.
 *
 * A robots.txt that cannot be read is reported as `allowed: null` (signal unknown)
 * rather than failing the whole inspection.
 */
export async function inspectRobots(target: URL): Promise<RobotsInspection> {
  const robotsUrl = new URL('/robots.txt', target.origin);
  const base: RobotsInspection = {
    reachable: false,
    exists: false,
    allowed: null,
    userAgent: USER_AGENT_TOKEN,
    sitemaps: [],
  };

  try {
    const response = await safeFetch(robotsUrl, {
      timeoutMS: INSPECTOR_LIMITS.robotsTimeoutMS,
      maxBytes: INSPECTOR_LIMITS.robotsMaxBytes,
      accept: 'text/plain,*/*;q=0.5',
    });

    // 4xx means the server answered and published no rules, so crawling is allowed.
    if (response.status >= 400 && response.status < 500) {
      return { ...base, reachable: true, exists: false, allowed: true };
    }

    if (response.status < 200 || response.status >= 300) {
      // 5xx and other unexpected statuses leave the signal genuinely unknown.
      return { ...base, reachable: true, exists: false, allowed: null };
    }

    const parsed = parseRobotsTxt(response.body.toString('utf8'));
    const group = selectGroup(parsed.groups, USER_AGENT_TOKEN);
    const path = `${target.pathname}${target.search}`;

    return {
      reachable: true,
      exists: true,
      allowed: isPathAllowed(group, path),
      userAgent: USER_AGENT_TOKEN,
      sitemaps: parsed.sitemaps,
    };
  } catch {
    // Network failure, timeout or a blocked address: an optional signal, not a fatal error.
    return base;
  }
}
