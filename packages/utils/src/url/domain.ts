import { normalizeDomain } from './host.js';

/**
 * Domain normalization for projects.
 *
 * THE RULE, applied in order:
 *   1. trim surrounding whitespace and lowercase
 *   2. if the value carries a scheme (`https://example.com/path`), keep only the
 *      hostname — a pasted URL is a common, unambiguous mistake
 *   3. drop a trailing slash or path, a trailing dot, and a leading `www.`
 *   4. validate what remains as a hostname
 *
 * Everything else is REJECTED rather than repaired. Guessing at malformed input
 * would risk silently pointing a project at a domain the user never typed, and
 * the project domain is what IndexNow host validation is checked against.
 *
 * `www.` is stripped because Step 8 treats `example.com` and `www.example.com`
 * as the same host; storing the bare form keeps that comparison consistent.
 */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

/** Hostnames that never denote a public site a project could own. */
const FORBIDDEN = new Set(['localhost', 'local', 'internal', 'test', 'invalid', 'example']);

export function parseProjectDomain(input: unknown): string {
  if (typeof input !== 'string') {
    throw new DomainValidationError('Domain must be a string.');
  }

  let candidate = input.trim().toLowerCase();

  if (candidate === '') {
    throw new DomainValidationError('Domain must not be empty.');
  }

  if (candidate.length > 253 + 'https://'.length) {
    throw new DomainValidationError('Domain is too long.');
  }

  // A pasted URL is accepted; anything else keeps its literal form.
  if (candidate.includes('://')) {
    let parsed: URL;

    try {
      parsed = new URL(candidate);
    } catch {
      throw new DomainValidationError(`"${input.trim()}" is not a valid domain.`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DomainValidationError('Only http and https URLs can be used to derive a domain.');
    }

    candidate = parsed.hostname;
  } else {
    // Tolerate "example.com/" and "example.com/path" without a scheme.
    const slash = candidate.indexOf('/');

    if (slash !== -1) {
      candidate = candidate.slice(0, slash);
    }
  }

  if (candidate.includes('@') || candidate.includes(' ')) {
    throw new DomainValidationError(`"${input.trim()}" is not a valid domain.`);
  }

  // Strip an explicit port; a project is identified by its host alone.
  const colon = candidate.lastIndexOf(':');

  if (colon !== -1 && !candidate.includes('[')) {
    candidate = candidate.slice(0, colon);
  }

  const normalized = normalizeDomain(candidate);

  if (normalized === '') {
    throw new DomainValidationError(`"${input.trim()}" is not a valid domain.`);
  }

  if (!HOSTNAME_PATTERN.test(normalized)) {
    throw new DomainValidationError(
      `"${input.trim()}" is not a valid domain. Use a hostname such as example.com.`,
    );
  }

  const label = normalized.split('.')[0] ?? '';
  const tld = normalized.split('.').pop() ?? '';

  if (FORBIDDEN.has(normalized) || FORBIDDEN.has(tld) || (FORBIDDEN.has(label) && normalized.split('.').length < 2)) {
    throw new DomainValidationError(`"${normalized}" is not a public domain.`);
  }

  return normalized;
}

/** Non-throwing variant. */
export function tryParseProjectDomain(input: unknown): string | null {
  try {
    return parseProjectDomain(input);
  } catch {
    return null;
  }
}
