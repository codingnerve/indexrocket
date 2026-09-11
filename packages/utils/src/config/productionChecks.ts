/**
 * Production configuration checks, shared by the API and the worker.
 *
 * `errors` stop the process from starting; `warnings` are logged. Every message
 * names the variable, never its value, so these can be printed safely.
 */
export interface ProductionCheckResult {
  errors: string[];
  warnings: string[];
}

function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(hostname.toLowerCase());
}

function requirePublicHttps(value: string | null, name: string, problems: string[]): void {
  if (value === null || value.trim() === '') {
    problems.push(`${name} must be set in production.`);
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${name} is not a valid URL.`);
    return;
  }

  if (parsed.protocol !== 'https:') {
    problems.push(`${name} must use https in production.`);
  }

  if (isLocalHost(parsed.hostname)) {
    problems.push(`${name} must not point at localhost in production.`);
  }
}

/** A key made of one repeated character is a placeholder, not a secret. */
function isWeakKey(raw: string): boolean {
  const trimmed = raw.trim();

  return trimmed === '' || /^(.)\1+$/.test(trimmed);
}

function credentialWarnings(mongodbUri: string, redisUrl: string, warnings: string[]): void {
  try {
    const mongo = new URL(mongodbUri);

    if (mongo.username === '' && !isLocalHost(mongo.hostname)) {
      warnings.push('MONGODB_URI has no credentials but points at a non-local host.');
    }
  } catch {
    // An unparseable URI is reported by the driver on connect.
  }

  try {
    const redis = new URL(redisUrl);

    if (redis.password === '') {
      warnings.push('REDIS_URL has no password. Enable Redis AUTH (requirepass or ACL) in production.');
    }

    if (redis.protocol !== 'rediss:' && !isLocalHost(redis.hostname)) {
      warnings.push('REDIS_URL is not TLS (rediss://) and points at a non-local host.');
    }
  } catch {
    // Reported by ioredis on connect.
  }
}

export interface ApiProductionInput {
  nodeEnv: string;
  frontendUrl: string | null;
  encryptionKeyRaw: string;
  googleConfigured: boolean;
  googleRedirectUri: string | null;
  mongodbUri: string;
  redisUrl: string;
}

export function checkApiProductionEnv(input: ApiProductionInput): ProductionCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.nodeEnv !== 'production') {
    return { errors, warnings };
  }

  requirePublicHttps(input.frontendUrl, 'FRONTEND_URL', errors);

  if (isWeakKey(input.encryptionKeyRaw)) {
    errors.push('ENCRYPTION_KEY must be a real 32-byte random key in production.');
  }

  if (input.googleConfigured) {
    requirePublicHttps(input.googleRedirectUri, 'GOOGLE_REDIRECT_URI', errors);
  } else {
    warnings.push('Google OAuth is not configured; Search Console routes will answer 503.');
  }

  credentialWarnings(input.mongodbUri, input.redisUrl, warnings);

  return { errors, warnings };
}

export interface WorkerProductionInput {
  nodeEnv: string;
  encryptionKeyRaw: string;
  indexNowEndpoint: string;
  googleConfigured: boolean;
  googleRedirectUri: string | null;
  mongodbUri: string;
  redisUrl: string;
}

export function checkWorkerProductionEnv(input: WorkerProductionInput): ProductionCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.nodeEnv !== 'production') {
    return { errors, warnings };
  }

  if (isWeakKey(input.encryptionKeyRaw)) {
    errors.push('ENCRYPTION_KEY must be a real 32-byte random key in production (and match the API).');
  }

  requirePublicHttps(input.indexNowEndpoint, 'INDEXNOW_ENDPOINT', errors);

  if (input.googleConfigured) {
    requirePublicHttps(input.googleRedirectUri, 'GOOGLE_REDIRECT_URI', errors);
  }

  credentialWarnings(input.mongodbUri, input.redisUrl, warnings);

  return { errors, warnings };
}

/** Throws one error listing every problem, so a bad deploy fails loudly and once. */
export function enforceProductionChecks(service: string, result: ProductionCheckResult): void {
  for (const warning of result.warnings) {
    console.warn(`[${service}] config warning: ${warning}`);
  }

  if (result.errors.length > 0) {
    throw new Error(
      `[${service}] refusing to start with an unsafe production configuration:\n  - ${result.errors.join('\n  - ')}`,
    );
  }
}
