import { request as httpsRequest } from 'node:https';

/**
 * Minimal HTTPS client for Google's documented APIs.
 *
 * Every destination is a fixed, hard-coded Google host asserted against this
 * allowlist. No user-supplied URL is ever fetched here, so this is not an SSRF
 * surface: the URL a user asks us to inspect is sent to Google as a JSON
 * *parameter*, never as a request target. (User-supplied URLs continue to go
 * through the SSRF-guarded fetcher in the worker.)
 */
const ALLOWED_HOSTS = new Set([
  'oauth2.googleapis.com',
  'accounts.google.com',
  'searchconsole.googleapis.com',
  'www.googleapis.com',
]);

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface GoogleHttpResponse {
  status: number;
  body: string;
}

export class GoogleHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'GoogleHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface GoogleRequestOptions {
  method: 'GET' | 'POST';
  /** Bearer token. Never logged, never echoed into an error. */
  accessToken?: string;
  body?: string;
  contentType?: string;
  timeoutMS?: number;
}

export async function googleRequest(
  url: string,
  options: GoogleRequestOptions,
): Promise<GoogleHttpResponse> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new Error('Google API requests must use HTTPS.');
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to call non-allowlisted host "${parsed.hostname}".`);
  }

  const payload = options.body === undefined ? null : Buffer.from(options.body, 'utf8');
  const headers: Record<string, string> = { accept: 'application/json' };

  if (options.accessToken !== undefined) {
    headers['authorization'] = `Bearer ${options.accessToken}`;
  }

  if (payload !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
    headers['content-length'] = String(payload.byteLength);
  }

  return await new Promise<GoogleHttpResponse>((resolve, reject) => {
    const req = httpsRequest(
      parsed,
      { method: options.method, headers, timeout: options.timeoutMS ?? DEFAULT_TIMEOUT_MS },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;

        response.on('data', (chunk: Buffer) => {
          received += chunk.length;

          if (received > MAX_RESPONSE_BYTES) {
            response.destroy();
            reject(new Error('Google API response exceeded the size limit.'));
            return;
          }

          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });

        response.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Google API request to ${parsed.hostname} timed out.`));
    });

    req.on('error', reject);

    if (payload !== null) {
      req.write(payload);
    }

    req.end();
  });
}

/** Extracts Google's error message without leaking request credentials. */
export function describeGoogleError(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);

    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = (parsed as { error: unknown }).error;

      if (typeof error === 'string') {
        return `${error} (HTTP ${status})`;
      }

      if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message: unknown }).message;

        if (typeof message === 'string') {
          return `${message} (HTTP ${status})`;
        }
      }
    }
  } catch {
    // Fall through to the generic description.
  }

  return `Google API returned HTTP ${status}.`;
}
