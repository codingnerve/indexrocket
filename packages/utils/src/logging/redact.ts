/**
 * Log-safe URL rendering, shared by the API request log and the worker.
 *
 * Query parameters that commonly carry credentials are replaced with a marker,
 * embedded userinfo is dropped, and the fragment is removed. The path, host and
 * every other parameter are kept so the line stays useful for operations.
 *
 * The OAuth callback is the motivating case: its URL carries a single-use
 * authorization code that anyone reading the log could exchange for tokens.
 */
const SENSITIVE_PARAMS = new Set([
  'code',
  'state',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'key',
  'apikey',
  'api_key',
  'token',
  'password',
  'passwd',
  'secret',
  'session',
  'sid',
  'auth',
  'authorization',
  'signature',
  'sig',
]);

const REDACTION = '[redacted]';

function redactParams(params: URLSearchParams): boolean {
  let changed = false;

  for (const name of [...params.keys()]) {
    if (SENSITIVE_PARAMS.has(name.toLowerCase())) {
      params.set(name, REDACTION);
      changed = true;
    }
  }

  return changed;
}

/**
 * Accepts either a request target ("/api/x?code=...") or an absolute URL
 * ("https://host/x?token=..."). Never throws: an unparseable absolute URL is
 * replaced entirely rather than logged raw.
 */
export function redactUrlForLog(input: string): string {
  if (typeof input !== 'string' || input === '') {
    return input;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      url.username = '';
      url.password = '';
      url.hash = '';
      redactParams(url.searchParams);

      return url.toString();
    } catch {
      return '[unparseable url]';
    }
  }

  const separator = input.indexOf('?');

  if (separator === -1) {
    return input;
  }

  const path = input.slice(0, separator);
  const params = new URLSearchParams(input.slice(separator + 1));

  return redactParams(params) ? `${path}?${params.toString()}` : input;
}
