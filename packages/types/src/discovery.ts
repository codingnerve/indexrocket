/**
 * Discovery notifies a search engine that a URL exists or changed.
 *
 * It is NOT indexing. A provider accepting a notification means only that the
 * request was well-formed and the key verified — never that the URL was crawled
 * or indexed. See docs/DISCOVERY.md.
 */
export type DiscoveryProviderName = 'indexnow';

/**
 * not_submitted - never notified
 * pending       - a discovery job is queued or running
 * accepted      - the provider accepted the notification
 * failed        - the provider rejected it, or it could not be delivered
 */
export type IndexNowStatus = 'not_submitted' | 'pending' | 'accepted' | 'failed';

/** Payload carried on the discovery queue. */
export interface DiscoveryJobData {
  projectId: string;
  urlIds: string[];
}

export interface DiscoveryResult {
  provider: DiscoveryProviderName;
  success: boolean;
  statusCode: number | null;
  /** True only when the provider accepted the notification for processing. */
  accepted: boolean;
  message: string;
  submittedUrls: string[];
  failedUrls: string[];
  submittedAt: string;
}

export interface DiscoveryJobResult {
  provider: DiscoveryProviderName;
  accepted: boolean;
  statusCode: number | null;
  urlIds: string[];
  submittedAt: string;
}

/** Safe, key-free discovery view returned by the API. */
export interface DiscoveryStatusView {
  indexNow: {
    status: IndexNowStatus;
    submittedAt: string | null;
    responseCode: number | null;
    lastError: string | null;
  };
}
