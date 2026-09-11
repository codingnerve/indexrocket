/** The IndexNow JSON notification body, exactly as the protocol defines it. */
export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
}

/**
 * Response codes defined by the IndexNow protocol.
 *
 * 200 OK        - notification received
 * 202 Accepted  - received; key validation still pending
 * 400 Bad Request        - invalid format
 * 403 Forbidden          - key not valid (not found, or does not match)
 * 422 Unprocessable      - URLs do not belong to the host, or key mismatch
 * 429 Too Many Requests  - rate limited / suspected spam
 */
export const INDEXNOW_ACCEPTED_STATUSES = [200, 202] as const;

export const INDEXNOW_PERMANENT_STATUSES = [400, 403, 422] as const;

export function describeIndexNowStatus(status: number): string {
  switch (status) {
    case 200:
      return 'Notification received.';
    case 202:
      return 'Notification received; key validation pending.';
    case 400:
      return 'Invalid request format.';
    case 403:
      return 'Key not valid: not found at the key location, or does not match.';
    case 422:
      return 'URLs do not belong to the host, or the key does not match the protocol schema.';
    case 429:
      return 'Rate limited by the provider.';
    default:
      return `Unexpected provider response (HTTP ${status}).`;
  }
}
