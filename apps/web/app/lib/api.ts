import type { SessionUser } from './types';

export type { SessionUser } from './types';

/**
 * API base URL. NEXT_PUBLIC_ variables are inlined at build time, so a
 * production bundle carries whatever value existed when it was built. There is
 * deliberately no localhost fallback in production: a bundle built without the
 * variable fails loudly instead of silently calling the visitor's own machine.
 */
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (configured !== undefined && configured !== '') {
    return configured.replace(/\/+$/, '');
  }

  return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000';
}

export const API = resolveApiBase();

/** An API failure. `status` is the HTTP status, or 0 when the API could not be reached. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Every request sends the session cookie and nothing else.
 *
 * `credentials: 'include'` is what carries the HttpOnly session cookie; the
 * browser holds it and JavaScript cannot read it. No token is kept in
 * localStorage, so there is nothing for a script injection to steal.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (API === '') {
    throw new ApiError('This build has no API URL configured (NEXT_PUBLIC_API_URL).', 0);
  }

  let response: Response;

  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('We couldn’t reach IndexRocket. Check your connection and try again.', 0);
  }

  const text = await response.text();
  let json: unknown = {};

  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }

  if (!response.ok) {
    const message =
      typeof json === 'object' && json !== null && 'message' in json && typeof json.message === 'string'
        ? json.message
        : `HTTP ${response.status}`;

    throw new ApiError(message, response.status);
  }

  return json as T;
}

export type SessionResult =
  | { state: 'authenticated'; user: SessionUser }
  | { state: 'unauthenticated' }
  | { state: 'error'; message: string };

/** Asks the API who the visitor is. A network failure is not treated as "signed out". */
export async function loadSession(): Promise<SessionResult> {
  try {
    const json = await apiFetch<{ data: SessionUser }>('/api/auth/me');

    return { state: 'authenticated', user: json.data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { state: 'unauthenticated' };
    }

    return { state: 'error', message: describeError(error) };
  }
}

const GENERIC_MESSAGES: Record<number, string> = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You don’t have permission to access this resource.',
  404: 'We couldn’t find that resource.',
  409: 'This action can’t be completed right now. Please check the current status.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'Something went wrong on our side. Please try again.',
};

/**
 * Turns any failure into a sentence a person can act on.
 *
 * The API only ever sends curated messages (stack traces never leave it), so a
 * specific server message such as "Project not found." or an IndexNow cooldown
 * reason is shown as-is; generic statuses fall back to fixed wording.
 */
export function describeError(error: unknown, options: { preferServerMessage?: boolean } = {}): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.';
  }

  if (error.status === 0) {
    return error.message;
  }

  const serverMessage = error.message.startsWith('HTTP ') ? null : error.message;

  if (error.status >= 500) {
    return serverMessage !== null && serverMessage !== 'Internal server error'
      ? serverMessage
      : (GENERIC_MESSAGES[500] as string);
  }

  if ((error.status === 401 || error.status === 429) && options.preferServerMessage !== true) {
    return GENERIC_MESSAGES[error.status] as string;
  }

  return serverMessage ?? GENERIC_MESSAGES[error.status] ?? 'The request could not be completed.';
}
