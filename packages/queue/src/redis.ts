import { Redis } from 'ioredis';

export type RedisStatus = 'connected' | 'connecting' | 'disconnected';

export interface RedisConnectionOptions {
  /** Overrides REDIS_URL. Useful for tests and for separate worker deployments. */
  url?: string;
  /** Milliseconds allowed for the initial connection before startup fails. */
  connectTimeoutMS?: number;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` because its workers issue blocking
 * commands that must not be aborted by ioredis' per-command retry limit.
 */
const BULLMQ_REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  // Connect explicitly at startup so an unreachable Redis fails loudly instead of
  // being masked by background reconnect attempts.
  lazyConnect: true,
  retryStrategy(attempt: number): number {
    return Math.min(attempt * 200, 5_000);
  },
};

let connection: Redis | null = null;
/** Last socket-level error, used to explain an otherwise opaque connect() rejection. */
let lastConnectionError: string | null = null;

function resolveUrl(url: string | undefined): string {
  const value = url ?? process.env.REDIS_URL;

  if (value === undefined || value.trim() === '') {
    throw new Error('REDIS_URL is not set. Add it to your environment (see .env.example).');
  }

  return value.trim();
}

function describeTarget(client: Redis): string {
  return `${client.options.host ?? '127.0.0.1'}:${client.options.port ?? 6379}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMS: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Returns the process-wide Redis connection, creating it on first use.
 * Sharing one connection keeps the queue, the worker and health checks off
 * separate sockets.
 */
export function getRedisConnection(options: RedisConnectionOptions = {}): Redis {
  if (connection !== null) {
    return connection;
  }

  const client = new Redis(resolveUrl(options.url), BULLMQ_REDIS_OPTIONS);

  // ioredis throws on unhandled 'error' events; record and log instead of crashing.
  client.on('error', (error: unknown) => {
    lastConnectionError = error instanceof Error ? error.message : String(error);
    console.error('Redis connection error:', lastConnectionError);
  });

  client.on('ready', () => {
    lastConnectionError = null;
  });

  client.on('end', () => {
    console.warn('Redis disconnected.');
  });

  client.on('reconnecting', () => {
    console.warn('Redis reconnecting...');
  });

  connection = client;

  return client;
}

/** Establishes and verifies the Redis connection. Throws clearly when unreachable. */
export async function connectRedis(options: RedisConnectionOptions = {}): Promise<void> {
  const client = getRedisConnection(options);
  const timeoutMS = options.connectTimeoutMS ?? 10_000;
  const target = describeTarget(client);

  try {
    if (client.status === 'wait' || client.status === 'end') {
      await withTimeout(
        client.connect(),
        timeoutMS,
        `Timed out after ${timeoutMS}ms connecting to Redis at ${target}.`,
      );
    }

    // A live socket is not proof of a usable server; PING confirms it answers.
    await withTimeout(
      client.ping(),
      timeoutMS,
      `Timed out after ${timeoutMS}ms waiting for a Redis PING response from ${target}.`,
    );
  } catch (error) {
    const reason = lastConnectionError ?? (error instanceof Error ? error.message : String(error));

    throw new Error(`Could not connect to Redis at ${target}: ${reason}`, { cause: error });
  }

  console.log(`Redis connected: ${target}`);
}

export async function disconnectRedis(): Promise<void> {
  if (connection === null) {
    return;
  }

  const client = connection;
  connection = null;
  await client.quit();
}

export function getRedisStatus(): RedisStatus {
  if (connection === null) {
    return 'disconnected';
  }

  switch (connection.status) {
    case 'ready':
      return 'connected';
    case 'connect':
    case 'connecting':
    case 'reconnecting':
      return 'connecting';
    default:
      return 'disconnected';
  }
}

export function isRedisConnected(): boolean {
  return getRedisStatus() === 'connected';
}

/** Readiness probe: a real PING, bounded in time. Never throws. */
export async function pingRedis(timeoutMS = 2_000): Promise<boolean> {
  if (connection === null || connection.status !== 'ready') {
    return false;
  }

  try {
    const reply = await withTimeout(connection.ping(), timeoutMS, 'Redis ping timed out.');

    return reply === 'PONG';
  } catch {
    return false;
  }
}
