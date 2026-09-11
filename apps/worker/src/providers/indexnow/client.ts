import { DISCOVERY_LIMITS } from '../../config/limits.js';
import { safeFetch } from '../../services/httpInspector.js';
import type { IndexNowPayload } from './types.js';

export interface IndexNowResponse {
  statusCode: number;
  body: string;
}

/**
 * Sends one IndexNow notification.
 *
 * The request goes through the shared SSRF-guarded HTTP client, so the endpoint
 * is subject to the same network rules as every other outbound request.
 */
export async function submitIndexNow(
  endpoint: string,
  payload: IndexNowPayload,
): Promise<IndexNowResponse> {
  const response = await safeFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
    contentType: 'application/json; charset=utf-8',
    accept: 'application/json,*/*;q=0.5',
    timeoutMS: DISCOVERY_LIMITS.notifyTimeoutMS,
    maxBytes: DISCOVERY_LIMITS.notifyMaxResponseBytes,
    maxRedirects: DISCOVERY_LIMITS.notifyMaxRedirects,
  });

  return {
    statusCode: response.status,
    body: response.body.toString('utf8').slice(0, 500),
  };
}
