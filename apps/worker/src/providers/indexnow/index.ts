import type { DiscoveryResult } from '@indexrocket/types';
import { hostOfUrl } from '@indexrocket/utils';

import { DISCOVERY_LIMITS } from '../../config/limits.js';
import { env } from '../../config/env.js';
import { PermanentProviderError, type DiscoveryNotifyInput, type DiscoveryProvider } from '../types.js';
import { submitIndexNow } from './client.js';
import { verifyKey } from './keyVerifier.js';
import {
  describeIndexNowStatus,
  INDEXNOW_ACCEPTED_STATUSES,
  INDEXNOW_PERMANENT_STATUSES,
  type IndexNowPayload,
} from './types.js';

function isAccepted(status: number): boolean {
  return (INDEXNOW_ACCEPTED_STATUSES as readonly number[]).includes(status);
}

function isPermanentRejection(status: number): boolean {
  return (INDEXNOW_PERMANENT_STATUSES as readonly number[]).includes(status);
}

export const indexNowProvider: DiscoveryProvider = {
  name: 'indexnow',

  async notifyUrls(input: DiscoveryNotifyInput): Promise<DiscoveryResult> {
    const submittedAt = new Date().toISOString();
    const base: Omit<DiscoveryResult, 'success' | 'accepted' | 'message' | 'statusCode'> = {
      provider: 'indexnow',
      submittedUrls: [],
      failedUrls: input.urls,
      submittedAt,
    };

    if (input.urls.length === 0) {
      throw new PermanentProviderError('No URLs to notify.');
    }

    if (input.urls.length > DISCOVERY_LIMITS.maxUrlsPerNotification) {
      throw new PermanentProviderError(
        `Too many URLs in one notification (${input.urls.length} > ${DISCOVERY_LIMITS.maxUrlsPerNotification}).`,
      );
    }

    // The protocol requires every URL in a request to belong to the notified host.
    const foreign = input.urls.filter((url) => hostOfUrl(url) !== input.host);

    if (foreign.length > 0) {
      throw new PermanentProviderError(
        `${foreign.length} URL(s) do not belong to host "${input.host}".`,
      );
    }

    const verification = await verifyKey(input.host, input.key, input.keyLocation);

    if (!verification.verified) {
      // A bad or unpublished key cannot succeed by retrying.
      throw new PermanentProviderError(
        `IndexNow key verification failed: ${verification.reason}`,
        verification.statusCode,
      );
    }

    const payload: IndexNowPayload = {
      host: input.host,
      key: input.key,
      keyLocation: verification.keyLocation,
      urlList: input.urls,
    };

    const response = await submitIndexNow(env.indexNowEndpoint, payload);
    const accepted = isAccepted(response.statusCode);
    const message = describeIndexNowStatus(response.statusCode);

    if (!accepted && isPermanentRejection(response.statusCode)) {
      throw new PermanentProviderError(message, response.statusCode);
    }

    return {
      ...base,
      statusCode: response.statusCode,
      success: accepted,
      accepted,
      message,
      submittedUrls: accepted ? input.urls : [],
      failedUrls: accepted ? [] : input.urls,
    };
  },
};
