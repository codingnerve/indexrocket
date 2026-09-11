import { UrlValidationError } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;

/**
 * Parses and normalizes a URL for consistent storage and comparison.
 *
 * Normalization is deliberately conservative: hostname casing and the default
 * port are normalized and the fragment is dropped (it never reaches the server),
 * but the path, its trailing slash and the entire query string are preserved
 * because they change which resource is addressed.
 */
export function normalizeUrl(input: string): string {
  return parseAndNormalizeUrl(input).toString();
}

/** Same as {@link normalizeUrl} but returns the parsed URL for further inspection. */
export function parseAndNormalizeUrl(input: string): URL {
  if (typeof input !== 'string') {
    throw new UrlValidationError('URL must be a string.');
  }

  const trimmed = input.trim();

  if (trimmed === '') {
    throw new UrlValidationError('URL must not be empty.');
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    throw new UrlValidationError(`URL exceeds the maximum length of ${MAX_URL_LENGTH} characters.`);
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new UrlValidationError(`"${trimmed}" is not a valid absolute URL.`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UrlValidationError(
      `Unsupported protocol "${url.protocol.replace(':', '')}". Only http and https are allowed.`,
    );
  }

  // Embedded credentials would be persisted and replayed on every inspection.
  if (url.username !== '' || url.password !== '') {
    throw new UrlValidationError('URLs must not contain embedded credentials.');
  }

  if (url.hostname === '') {
    throw new UrlValidationError('URL must contain a hostname.');
  }

  // The URL parser lowercases the hostname; a trailing dot is the same host.
  if (url.hostname.endsWith('.') && url.hostname !== '.') {
    url.hostname = url.hostname.slice(0, -1);
  }

  // Fragments are client-side only and never sent to the server.
  url.hash = '';

  if (url.pathname === '') {
    url.pathname = '/';
  }

  return url;
}

/** Returns the normalized form, or null when the input is not a usable URL. */
export function tryNormalizeUrl(input: string): string | null {
  try {
    return normalizeUrl(input);
  } catch {
    return null;
  }
}
