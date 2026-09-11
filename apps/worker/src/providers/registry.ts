import type { DiscoveryProviderName } from '@indexrocket/types';

import { indexNowProvider } from './indexnow/index.js';
import type { DiscoveryProvider } from './types.js';

const providers: Record<DiscoveryProviderName, DiscoveryProvider> = {
  indexnow: indexNowProvider,
};

export function getDiscoveryProvider(name: DiscoveryProviderName): DiscoveryProvider {
  return providers[name];
}
