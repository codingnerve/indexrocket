export { SsrfBlockedError, UrlValidationError } from './url/errors.js';
export { classifyAddress, isPublicAddress, type BlockedRange } from './url/ipRanges.js';
export { normalizeUrl, parseAndNormalizeUrl, tryNormalizeUrl } from './url/normalize.js';
export { hostMatchesDomain, hostOfUrl, normalizeDomain } from './url/host.js';
export {
  assertSafeUrl,
  assertSafeUrlShape,
  isSafeUrl,
  type SafeTarget,
  type SsrfCheckOptions,
} from './url/ssrf.js';
export {
  DISCOVERY_COOLDOWN_MS,
  evaluateDiscoveryEligibility,
  type DiscoveryCandidate,
  type DiscoveryProjectContext,
  type EligibilityVerdict,
} from './discovery/eligibility.js';

export {
  decryptSecret,
  encryptSecret,
  EncryptionError,
  generateSecureToken,
  parseEncryptionKey,
  safeEquals,
} from './crypto/encryption.js';

export {
  checkPasswordPolicy,
  hashPassword,
  isCurrentPasswordHash,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordError,
  verifyPassword,
  type PasswordPolicyResult,
} from './crypto/password.js';

export { EMAIL_MAX_LENGTH, isValidEmail, normalizeEmail } from './identity/email.js';

export {
  DomainValidationError,
  parseProjectDomain,
  tryParseProjectDomain,
} from './url/domain.js';

export { redactUrlForLog } from './logging/redact.js';
export { runShutdown, type ShutdownOptions, type ShutdownResult, type ShutdownStep } from './lifecycle/shutdown.js';
export {
  checkApiProductionEnv,
  checkWorkerProductionEnv,
  enforceProductionChecks,
  type ApiProductionInput,
  type ProductionCheckResult,
  type WorkerProductionInput,
} from './config/productionChecks.js';
