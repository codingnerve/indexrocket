import mongoose from 'mongoose';

export type DatabaseStatus =
  | 'connected'
  | 'connecting'
  | 'disconnecting'
  | 'disconnected'
  | 'uninitialized';

const CONNECTION_STATES: Record<number, DatabaseStatus> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

export interface ConnectDatabaseOptions {
  /** Overrides MONGODB_URI. Useful for tests and for the future worker application. */
  uri?: string;
  /** Milliseconds before the initial server selection gives up. */
  serverSelectionTimeoutMS?: number;
}

/** Shared across every caller in the process so repeated calls reuse one connection. */
let connectionPromise: Promise<typeof mongoose> | null = null;

function resolveUri(uri: string | undefined): string {
  const value = uri ?? process.env.MONGODB_URI;

  if (value === undefined || value.trim() === '') {
    throw new Error(
      'MONGODB_URI is not set. Add it to your environment (see apps/api/.env.example).',
    );
  }

  return value.trim();
}

function registerConnectionLogging(): void {
  const { connection } = mongoose;

  connection.on('error', (error: unknown) => {
    console.error('MongoDB connection error:', error);
  });

  connection.on('disconnected', () => {
    console.warn('MongoDB disconnected.');
  });

  connection.on('reconnected', () => {
    console.log('MongoDB reconnected.');
  });
}

/**
 * Connects to MongoDB, reusing an existing connection when one is already
 * established or in flight. Throws with a clear message when the URI is missing
 * or the server is unreachable.
 */
export async function connectDatabase(options: ConnectDatabaseOptions = {}): Promise<void> {
  if (getDatabaseStatus() === 'connected') {
    return;
  }

  if (connectionPromise !== null) {
    await connectionPromise;
    return;
  }

  const uri = resolveUri(options.uri);

  registerConnectionLogging();

  connectionPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
  });

  try {
    await connectionPromise;
    console.log(`MongoDB connected: database "${mongoose.connection.name}"`);
  } catch (error) {
    // Let the next call retry instead of permanently caching a failed attempt.
    connectionPromise = null;
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (connectionPromise === null && getDatabaseStatus() === 'disconnected') {
    return;
  }

  connectionPromise = null;
  await mongoose.disconnect();
}

export function getDatabaseStatus(): DatabaseStatus {
  return CONNECTION_STATES[mongoose.connection.readyState] ?? 'uninitialized';
}

export function isDatabaseConnected(): boolean {
  return getDatabaseStatus() === 'connected';
}

/**
 * Readiness probe: a real round trip to the server, bounded in time. Reports
 * false rather than throwing, and never includes connection details.
 */
export async function pingDatabase(timeoutMS = 2_000): Promise<boolean> {
  const handle = mongoose.connection.db;

  if (getDatabaseStatus() !== 'connected' || handle === undefined) {
    return false;
  }

  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      handle.admin().ping(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMS);
      }),
    ]);

    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
