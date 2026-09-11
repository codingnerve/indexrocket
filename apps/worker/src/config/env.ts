import {
  checkWorkerProductionEnv,
  enforceProductionChecks,
  parseEncryptionKey,
} from '@indexrocket/utils';
import { config } from 'dotenv';

config();

export type NodeEnv = 'development' | 'production' | 'test';

interface EnvConfig {
  readonly nodeEnv: NodeEnv;
  readonly mongodbUri: string;
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly discoveryConcurrency: number;
  readonly submissionConcurrency: number;
  readonly discoveryRateMax: number;
  readonly discoveryRateDurationMS: number;
  readonly indexNowEndpoint: string;
  readonly google: { clientId: string; clientSecret: string; redirectUri: string } | null;
  readonly encryptionKey: Buffer;
  /** Loopback-only by default; the health endpoint is for the local supervisor. */
  readonly healthHost: string;
  /** 0 disables the health endpoint. */
  readonly healthPort: number;
  /** How long a deploy waits for in-flight jobs before forcing exit. */
  readonly shutdownTimeoutMS: number;
  readonly isProduction: boolean;
}

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_DISCOVERY_CONCURRENCY = 2;
const DEFAULT_SUBMISSION_CONCURRENCY = 3;
/** At most 10 notifications per minute by default. */
const DEFAULT_DISCOVERY_RATE_MAX = 10;
const DEFAULT_DISCOVERY_RATE_DURATION_MS = 60_000;
const DEFAULT_INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const DEFAULT_HEALTH_HOST = '127.0.0.1';
const DEFAULT_HEALTH_PORT = 5100;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 60_000;

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }

  if (value === undefined || value.trim() === '') {
    return 'development';
  }

  throw new Error(`Invalid NODE_ENV value: "${value}". Expected "development", "production" or "test".`);
}

function parseConcurrency(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_CONCURRENCY;
  }

  const concurrency = Number(value);

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid WORKER_CONCURRENCY value: "${value}". Expected a positive integer.`);
  }

  return concurrency;
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

function parsePort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid ${name} value: "${value}". Expected 0-65535 (0 disables).`);
  }

  return port;
}

/**
 * Google is optional for the worker: only batches that opt into Google
 * inspection need it, and a batch without it runs normally when it is absent.
 */
function parseGoogleEnv(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? '';

  if (clientId === '' || clientSecret === '' || redirectUri === '') {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

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
const indexNowEndpoint = process.env.INDEXNOW_ENDPOINT?.trim() || DEFAULT_INDEXNOW_ENDPOINT;

enforceProductionChecks(
  'worker',
  checkWorkerProductionEnv({
    nodeEnv,
    encryptionKeyRaw: process.env.ENCRYPTION_KEY ?? '',
    indexNowEndpoint,
    googleConfigured: google !== null,
    googleRedirectUri: google?.redirectUri ?? null,
    mongodbUri,
    redisUrl,
  }),
);

export const env: EnvConfig = {
  nodeEnv,
  mongodbUri,
  redisUrl,
  concurrency: parseConcurrency(process.env.WORKER_CONCURRENCY),
  discoveryConcurrency: parsePositiveInt(
    process.env.DISCOVERY_CONCURRENCY,
    DEFAULT_DISCOVERY_CONCURRENCY,
    'DISCOVERY_CONCURRENCY',
  ),
  submissionConcurrency: parsePositiveInt(
    process.env.SUBMISSION_CONCURRENCY,
    DEFAULT_SUBMISSION_CONCURRENCY,
    'SUBMISSION_CONCURRENCY',
  ),
  discoveryRateMax: parsePositiveInt(
    process.env.DISCOVERY_RATE_MAX,
    DEFAULT_DISCOVERY_RATE_MAX,
    'DISCOVERY_RATE_MAX',
  ),
  discoveryRateDurationMS: parsePositiveInt(
    process.env.DISCOVERY_RATE_DURATION_MS,
    DEFAULT_DISCOVERY_RATE_DURATION_MS,
    'DISCOVERY_RATE_DURATION_MS',
  ),
  indexNowEndpoint,
  google,
  encryptionKey: parseEncryptionKeyEnv(isProduction),
  healthHost: process.env.WORKER_HEALTH_HOST?.trim() || DEFAULT_HEALTH_HOST,
  healthPort: parsePort(process.env.WORKER_HEALTH_PORT, DEFAULT_HEALTH_PORT, 'WORKER_HEALTH_PORT'),
  shutdownTimeoutMS: parsePositiveInt(
    process.env.WORKER_SHUTDOWN_TIMEOUT_MS,
    DEFAULT_SHUTDOWN_TIMEOUT_MS,
    'WORKER_SHUTDOWN_TIMEOUT_MS',
  ),
  isProduction,
};
