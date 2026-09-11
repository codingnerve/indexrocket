import {
  checkApiProductionEnv,
  enforceProductionChecks,
  parseEncryptionKey,
} from '@indexrocket/utils';
import { config } from 'dotenv';

config();

export type NodeEnv = 'development' | 'production' | 'test';

export interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface EnvConfig {
  readonly port: number;
  /** Listen address. Null = all interfaces (Node default, used in development). */
  readonly host: string | null;
  readonly nodeEnv: NodeEnv;
  readonly frontendUrl: string;
  readonly mongodbUri: string;
  readonly redisUrl: string;
  /** Null when Google OAuth is not configured; the routes then answer 503. */
  readonly google: GoogleOAuthEnv | null;
  /** 32-byte key used to encrypt OAuth tokens at rest. */
  readonly encryptionKey: Buffer;
  /**
   * Express `trust proxy` setting. Behind Nginx the real client address arrives
   * in X-Forwarded-For; without this every user shares the proxy's address,
   * which would also make them share one login-throttle bucket.
   */
  readonly trustProxy: boolean | number | string;
  /** Successful registrations allowed per client address per hour. */
  readonly registerRateMax: number;
  readonly isProduction: boolean;
}

const DEFAULT_PORT = 5000;
const DEFAULT_FRONTEND_URL = 'http://localhost:3000';

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: "${value}". Expected an integer between 1 and 65535.`);
  }

  return port;
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }

  if (value === undefined || value.trim() === '') {
    return 'development';
  }

  throw new Error(`Invalid NODE_ENV value: "${value}". Expected "development", "production" or "test".`);
}

/**
 * Google OAuth is optional: without it the integration routes answer 503 rather
 * than the whole API refusing to boot. All three values must be present together.
 */
function parseGoogleEnv(): GoogleOAuthEnv | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? '';

  if (clientId === '' || clientSecret === '' || redirectUri === '') {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error('Invalid GOOGLE_REDIRECT_URI: not a valid URL.');
  }

  // The redirect URI is fixed server-side and must never come from a request.
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('GOOGLE_REDIRECT_URI must use HTTPS outside local development.');
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * A development fallback key keeps local setup friction-free, but production
 * must supply a real key: silently encrypting production tokens with a known
 * constant would be worse than refusing to start.
 */
function parseEncryptionKeyEnv(isProduction: boolean): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim() ?? '';

  if (raw === '') {
    if (isProduction) {
      throw new Error('ENCRYPTION_KEY is required in production. See .env.example.');
    }

    return parseEncryptionKey('0'.repeat(64));
  }

  return parseEncryptionKey(raw);
}

/**
 * In production the API sits behind Nginx on the same host, so it binds to
 * loopback unless told otherwise; port 5000 is then never reachable directly.
 */
function parseHost(value: string | undefined, isProduction: boolean): string | null {
  const raw = value?.trim() ?? '';

  if (raw === '') {
    return isProduction ? '127.0.0.1' : null;
  }

  return raw;
}

/** "" -> default, "true"/"false", a hop count, or an Express trust string such as "loopback". */
function parseTrustProxy(value: string | undefined, isProduction: boolean): boolean | number | string {
  const raw = value?.trim() ?? '';

  if (raw === '') {
    // In production the documented topology is Nginx on the same host.
    return isProduction ? 'loopback' : false;
  }

  if (raw === 'false') {
    return false;
  }

  if (raw === 'true') {
    return true;
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name} value: "${value}". Expected a positive integer.`);
  }

  return parsed;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }

  return value;
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const isProduction = nodeEnv === 'production';
const mongodbUri = requireEnv('MONGODB_URI');
const redisUrl = requireEnv('REDIS_URL');
const google = parseGoogleEnv();

// Every production problem is reported at once, by variable name only.
enforceProductionChecks(
  'api',
  checkApiProductionEnv({
    nodeEnv,
    frontendUrl: process.env.FRONTEND_URL?.trim() || null,
    encryptionKeyRaw: process.env.ENCRYPTION_KEY ?? '',
    googleConfigured: google !== null,
    googleRedirectUri: google?.redirectUri ?? null,
    mongodbUri,
    redisUrl,
  }),
);

export const env: EnvConfig = {
  port: parsePort(process.env.PORT),
  host: parseHost(process.env.HOST, isProduction),
  nodeEnv,
  frontendUrl: process.env.FRONTEND_URL?.trim() || DEFAULT_FRONTEND_URL,
  mongodbUri,
  redisUrl,
  google,
  encryptionKey: parseEncryptionKeyEnv(isProduction),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, isProduction),
  // Generous in development so test suites are never throttled; strict in production.
  registerRateMax: parsePositiveInt(
    process.env.REGISTER_RATE_MAX,
    isProduction ? 10 : 1_000,
    'REGISTER_RATE_MAX',
  ),
  isProduction,
};
