import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { SsrfBlockedError } from './errors.js';
import { classifyAddress } from './ipRanges.js';
import { parseAndNormalizeUrl } from './normalize.js';

/** Hostnames that always denote the local machine or an internal-only namespace. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback', 'broadcasthost']);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa'];

export interface SafeTarget {
  /** The normalized URL that was validated. */
  url: URL;
  /** Every address the hostname resolved to; all of them are public. */
  addresses: string[];
  /** The address a connection must be pinned to, preventing DNS rebinding. */
  pinnedAddress: string;
  family: 4 | 6;
}

export interface SsrfCheckOptions {
  /** Milliseconds allowed for DNS resolution. */
  dnsTimeoutMS?: number;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMS: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SsrfBlockedError(message));
    }, timeoutMS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function assertHostnameAllowed(hostname: string): void {
  const host = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(`Refusing to inspect "${hostname}": it refers to the local machine.`);
  }

  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new SsrfBlockedError(
      `Refusing to inspect "${hostname}": internal-only hostname namespace.`,
    );
  }
}

/**
 * Validates that a URL points at a routable public host and returns the address
 * a request must be pinned to.
 *
 * Hostname string checks alone are not sufficient, so the hostname is resolved and
 * every returned address is range-checked. The caller must connect to
 * `pinnedAddress` rather than resolving the name again, which closes the DNS
 * rebinding window between this check and the connection.
 */
/**
 * The checks that need no network: scheme, credentials, hostname namespace and
 * any literal IP address.
 *
 * This is for STORING a URL, not for fetching one. Resolving DNS to save a row
 * would make storage depend on a name being resolvable right now, and would turn
 * a 500-URL bulk import into 500 lookups. Nothing is weakened by deferring it:
 * {@link assertSafeUrl} still runs, with resolution and address pinning, before
 * any request is actually made.
 */
export function assertSafeUrlShape(input: string | URL): URL {
  const url = typeof input === 'string' ? parseAndNormalizeUrl(input) : input;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  assertHostnameAllowed(hostname);

  const literalFamily = isIP(hostname);

  if (literalFamily !== 0) {
    const classification = classifyAddress(hostname);

    if (classification.blocked) {
      throw new SsrfBlockedError(
        `Refusing to accept "${hostname}": address is in a blocked range (${classification.reason ?? 'unknown'}).`,
      );
    }
  }

  return url;
}

export async function assertSafeUrl(
  input: string | URL,
  options: SsrfCheckOptions = {},
): Promise<SafeTarget> {
  const url = typeof input === 'string' ? parseAndNormalizeUrl(input) : input;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  assertHostnameAllowed(hostname);

  // A literal IP needs no DNS round trip; validate and pin it directly.
  const literalFamily = isIP(hostname);

  if (literalFamily !== 0) {
    const classification = classifyAddress(hostname);

    if (classification.blocked) {
      throw new SsrfBlockedError(
        `Refusing to inspect "${hostname}": address is in a blocked range (${classification.reason ?? 'unknown'}).`,
      );
    }

    return {
      url,
      addresses: [hostname],
      pinnedAddress: hostname,
      family: literalFamily === 4 ? 4 : 6,
    };
  }

  const resolved = await withTimeout(
    dnsLookup(hostname, { all: true, verbatim: true }),
    options.dnsTimeoutMS ?? 5_000,
    `Refusing to inspect "${hostname}": DNS resolution timed out.`,
  ).catch((error: unknown) => {
    if (error instanceof SsrfBlockedError) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new SsrfBlockedError(`Could not resolve "${hostname}": ${reason}`);
  });

  if (resolved.length === 0) {
    throw new SsrfBlockedError(`Could not resolve "${hostname}": no addresses returned.`);
  }

  // Every address must be public: a single private answer is enough to abort,
  // because a later connection could pick it.
  for (const entry of resolved) {
    const classification = classifyAddress(entry.address);

    if (classification.blocked) {
      throw new SsrfBlockedError(
        `Refusing to inspect "${hostname}": it resolves to ${entry.address} (${classification.reason ?? 'blocked range'}).`,
      );
    }
  }

  const first = resolved[0];

  if (first === undefined) {
    throw new SsrfBlockedError(`Could not resolve "${hostname}": no addresses returned.`);
  }

  return {
    url,
    addresses: resolved.map((entry) => entry.address),
    pinnedAddress: first.address,
    family: first.family === 4 ? 4 : 6,
  };
}

/** Non-throwing variant used where a boolean is enough. */
export async function isSafeUrl(input: string | URL, options: SsrfCheckOptions = {}): Promise<boolean> {
  try {
    await assertSafeUrl(input, options);
    return true;
  } catch {
    return false;
  }
}
