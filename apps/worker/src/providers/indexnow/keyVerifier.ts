import { hostOfUrl } from '@indexrocket/utils';

import { DISCOVERY_LIMITS } from '../../config/limits.js';
import { safeFetch } from '../../services/httpInspector.js';

export interface KeyVerification {
  verified: boolean;
  keyLocation: string;
  statusCode: number | null;
  reason: string;
}

/** IndexNow keys are 8-128 characters from [a-zA-Z0-9-]. */
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function isValidKeyFormat(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** The protocol default: the key file sits at the host root, named after the key. */
export function defaultKeyLocation(host: string, key: string): string {
  return `https://${host}/${key}.txt`;
}

/**
 * Confirms the key is really published at the key location before any
 * notification is sent.
 *
 * A user-supplied key location is never trusted: it must be HTTPS and it must
 * live on the very host being notified, otherwise a project could point at a
 * file it controls on an unrelated domain and notify URLs for a host it does not
 * own. The fetch goes through the shared SSRF-guarded client and reads only a few
 * kilobytes.
 */
export async function verifyKey(
  host: string,
  key: string,
  configuredLocation: string | null | undefined,
): Promise<KeyVerification> {
  const keyLocation =
    configuredLocation !== null && configuredLocation !== undefined && configuredLocation.trim() !== ''
      ? configuredLocation.trim()
      : defaultKeyLocation(host, key);

  if (!isValidKeyFormat(key)) {
    return {
      verified: false,
      keyLocation,
      statusCode: null,
      reason: 'The key does not match the IndexNow format (8-128 characters of a-z, A-Z, 0-9, -).',
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(keyLocation);
  } catch {
    return { verified: false, keyLocation, statusCode: null, reason: 'The key location is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { verified: false, keyLocation, statusCode: null, reason: 'The key location must use HTTPS.' };
  }

  const locationHost = hostOfUrl(keyLocation);

  if (locationHost !== host) {
    return {
      verified: false,
      keyLocation,
      statusCode: null,
      reason: `The key location must be hosted on "${host}", but points at "${locationHost ?? 'unknown'}".`,
    };
  }

  try {
    const response = await safeFetch(parsed, {
      timeoutMS: DISCOVERY_LIMITS.keyVerificationTimeoutMS,
      maxBytes: DISCOVERY_LIMITS.keyFileMaxBytes,
      maxRedirects: DISCOVERY_LIMITS.keyFileMaxRedirects,
      accept: 'text/plain,*/*;q=0.5',
    });

    if (response.status !== 200) {
      return {
        verified: false,
        keyLocation,
        statusCode: response.status,
        reason: `The key file returned HTTP ${response.status}.`,
      };
    }

    if (response.truncated) {
      return {
        verified: false,
        keyLocation,
        statusCode: response.status,
        reason: 'The key file is larger than a key file should ever be.',
      };
    }

    const content = response.body.toString('utf8').trim();

    if (content !== key) {
      // The key itself is never included in the message.
      return {
        verified: false,
        keyLocation,
        statusCode: response.status,
        reason: 'The key file contents do not match the configured key.',
      };
    }

    return { verified: true, keyLocation, statusCode: response.status, reason: 'Key verified.' };
  } catch (error) {
    return {
      verified: false,
      keyLocation,
      statusCode: null,
      reason: `The key file could not be fetched: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}
