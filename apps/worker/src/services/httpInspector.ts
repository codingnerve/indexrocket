import { assertSafeUrl, parseAndNormalizeUrl } from '@indexrocket/utils';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import { INSPECTOR_LIMITS, USER_AGENT } from '../config/limits.js';

export interface SafeFetchOptions {
  timeoutMS?: number;
  maxRedirects?: number;
  maxBytes?: number;
  accept?: string;
  /** Defaults to GET. POST is used for provider notifications. */
  method?: 'GET' | 'POST';
  /** Request body for POST. Ignored for GET. */
  body?: string;
  /** Content-Type sent with `body`. */
  contentType?: string;
}

export interface SafeFetchResponse {
  status: number;
  finalUrl: string;
  contentType: string | null;
  contentLength: number | null;
  responseTimeMs: number;
  redirectCount: number;
  body: Buffer;
  /** True when the body hit the size cap and was cut short. */
  truncated: boolean;
}

/** Raised when the redirect chain exceeds the configured maximum. */
export class RedirectLimitError extends Error {
  constructor(limit: number) {
    super(`Exceeded the maximum of ${limit} redirects.`);
    this.name = 'RedirectLimitError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Forces the socket to the address already validated by the SSRF check.
 * Resolving the hostname again here would reopen the DNS rebinding window.
 */
function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;

    if (typeof done !== 'function') {
      return;
    }

    if (typeof options === 'object' && options !== null && options.all === true) {
      (done as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, [
        { address, family },
      ]);
      return;
    }

    (done as (err: null, address: string, family: number) => void)(null, address, family);
  }) as LookupFunction;
}

interface RequestPayload {
  method: 'GET' | 'POST';
  body: string | null;
  contentType: string | null;
}

async function requestOnce(
  url: URL,
  pinnedAddress: string,
  family: 4 | 6,
  timeoutMS: number,
  maxBytes: number,
  accept: string,
  payload: RequestPayload,
): Promise<{ response: IncomingMessage; body: Buffer; truncated: boolean }> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const encoded = payload.body === null ? null : Buffer.from(payload.body, 'utf8');

  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept,
    'accept-encoding': 'identity',
  };

  if (encoded !== null) {
    headers['content-type'] = payload.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(encoded.byteLength);
  }

  return await new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: payload.method,
        lookup: createPinnedLookup(pinnedAddress, family),
        headers,
        // Redirects are followed manually so every hop is re-validated.
        timeout: timeoutMS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;

        response.on('data', (chunk: Buffer) => {
          if (truncated) {
            return;
          }

          received += chunk.length;

          if (received > maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, maxBytes - (received - chunk.length))));
            // Enough has been read; stop the transfer rather than buffering more.
            response.destroy();
            return;
          }

          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve({ response, body: Buffer.concat(chunks), truncated });
        });

        response.on('close', () => {
          if (truncated) {
            resolve({ response, body: Buffer.concat(chunks), truncated });
          }
        });

        response.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${url.origin} timed out after ${timeoutMS}ms.`));
    });

    req.on('error', reject);

    if (encoded !== null) {
      req.write(encoded);
    }

    req.end();
  });
}

/**
 * Fetches a URL with SSRF validation on every hop, a bounded redirect chain,
 * a request timeout and a hard cap on how many bytes are read.
 */
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const timeoutMS = options.timeoutMS ?? INSPECTOR_LIMITS.httpTimeoutMS;
  const maxRedirects = options.maxRedirects ?? INSPECTOR_LIMITS.maxRedirects;
  const maxBytes = options.maxBytes ?? INSPECTOR_LIMITS.maxResponseBytes;
  const accept = options.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
  const method = options.method ?? 'GET';
  const payload = {
    method,
    body: method === 'POST' ? (options.body ?? '') : null,
    contentType: options.contentType ?? null,
  } as const;

  let current = typeof input === 'string' ? parseAndNormalizeUrl(input) : input;
  const startedAt = Date.now();

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    // Re-validated on every hop: a redirect must not be able to reach a private host.
    const target = await assertSafeUrl(current);
    const { response, body, truncated } = await requestOnce(
      target.url,
      target.pinnedAddress,
      target.family,
      timeoutMS,
      maxBytes,
      accept,
      payload,
    );

    const status = response.statusCode ?? 0;
    const location = firstHeader(response.headers.location);

    if (REDIRECT_STATUSES.has(status) && location !== null) {
      if (redirectCount === maxRedirects) {
        throw new RedirectLimitError(maxRedirects);
      }

      let next: URL;

      try {
        next = new URL(location, current);
      } catch {
        throw new Error(`Redirect to an invalid location: "${location}".`);
      }

      current = parseAndNormalizeUrl(next.toString());
      continue;
    }

    const contentLengthHeader = firstHeader(response.headers['content-length']);
    const contentLength =
      contentLengthHeader !== null && Number.isFinite(Number(contentLengthHeader))
        ? Number(contentLengthHeader)
        : null;

    return {
      status,
      finalUrl: current.toString(),
      contentType: firstHeader(response.headers['content-type']),
      contentLength,
      responseTimeMs: Date.now() - startedAt,
      redirectCount,
      body,
      truncated,
    };
  }

  throw new RedirectLimitError(maxRedirects);
}
