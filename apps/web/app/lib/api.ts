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

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  credits: number;
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
    throw new Error('This build has no API URL configured (NEXT_PUBLIC_API_URL).');
  }

  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

  const text = await response.text();
  const json: unknown = text === '' ? {} : JSON.parse(text);

  if (!response.ok) {
    const message =
      typeof json === 'object' && json !== null && 'message' in json
        ? String((json as { message: unknown }).message)
        : `HTTP ${response.status}`;

    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return json as T;
}

export async function fetchSession(): Promise<SessionUser | null> {
  try {
    const json = await apiFetch<{ data: SessionUser }>('/api/auth/me');

    return json.data;
  } catch {
    return null;
  }
}
