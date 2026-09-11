import type { DiscoveryProviderName, DiscoveryResult } from '@indexrocket/types';

export interface DiscoveryNotifyInput {
  /** The exact host every URL in this notification belongs to. */
  host: string;
  urls: string[];
  /** Provider credential. Never logged. */
  key: string;
  /** Where the key is published; defaults are provider-specific. */
  keyLocation?: string | null;
}

/**
 * A discovery provider announces URLs to a search engine.
 *
 * Implementations must never report success unless the provider actually accepted
 * the notification, and must never imply that acceptance means indexing.
 */
export interface DiscoveryProvider {
  readonly name: DiscoveryProviderName;
  notifyUrls(input: DiscoveryNotifyInput): Promise<DiscoveryResult>;
}

/** Thrown for provider rejections that cannot succeed on retry. */
export class PermanentProviderError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'PermanentProviderError';
    this.statusCode = statusCode;
  }
}
