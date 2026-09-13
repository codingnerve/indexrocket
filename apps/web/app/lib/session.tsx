'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useToast } from '../components/ui/toast';
import { apiFetch, ApiError, describeError, loadSession } from './api';
import type { SessionUser } from './types';

/** Only same-origin, path-absolute targets are accepted as a post-login destination. */
export function safeNextPath(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }

  return value;
}

type SessionState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

interface SessionContextValue {
  state: SessionState;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retry: () => void;
  /** Called when any API request answers 401 mid-session. */
  reportUnauthorized: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Resolves the current session and sends signed-out visitors to /login.
 *
 * The session cookie is HttpOnly and scoped to the API host, so the only way to
 * know whether the visitor is signed in is to ask the API. This is a rendering
 * convenience, never a security boundary: every protected operation is
 * authorized again on the server.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const signedOut = useRef(false);
  const expiredNotified = useRef(false);

  useEffect(() => {
    let active = true;

    void loadSession().then((result) => {
      if (!active) {
        return;
      }

      if (result.state === 'authenticated') {
        setState({ status: 'authenticated', user: result.user });
      } else if (result.state === 'unauthenticated') {
        setState({ status: 'unauthenticated' });
      } else {
        setState({ status: 'error', message: result.message });
      }
    });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (state.status !== 'unauthenticated') {
      return;
    }

    if (signedOut.current) {
      router.replace('/login');
      return;
    }

    const next = `${pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [state.status, router, pathname]);

  const reportUnauthorized = useCallback(() => {
    if (!expiredNotified.current) {
      expiredNotified.current = true;
      toast.error('Session expired', 'Your session has expired. Please sign in again.');
    }

    setState({ status: 'unauthenticated' });
  }, [toast]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // An already-expired session is as good as signed out.
      if (!(error instanceof ApiError && error.status === 401)) {
        toast.error('Couldn’t sign out', describeError(error));
        return;
      }
    }

    signedOut.current = true;
    setState({ status: 'unauthenticated' });
    toast.success('Signed out');
  }, [toast]);

  const refreshUser = useCallback(async () => {
    const result = await loadSession();

    if (result.state === 'authenticated') {
      setState({ status: 'authenticated', user: result.user });
    } else if (result.state === 'unauthenticated') {
      reportUnauthorized();
    }
  }, [reportUnauthorized]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ state, signOut, refreshUser, retry, reportUnauthorized }),
    [state, signOut, refreshUser, retry, reportUnauthorized],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionState(): SessionContextValue {
  const value = useContext(SessionContext);

  if (value === null) {
    throw new Error('useSessionState must be used inside <SessionProvider>.');
  }

  return value;
}

/** For pages rendered inside the authenticated shell, where a user always exists. */
export function useSession(): Omit<SessionContextValue, 'state'> & { user: SessionUser } {
  const { state, ...rest } = useSessionState();

  if (state.status !== 'authenticated') {
    throw new Error('useSession must be used inside the authenticated app shell.');
  }

  return { ...rest, user: state.user };
}
