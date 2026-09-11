'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiFetch, fetchSession, type SessionUser } from './api';

export interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * Resolves the current session and redirects to /login when there is none.
 *
 * The session cookie is HttpOnly, so the only way to know whether the visitor is
 * signed in is to ask the API. This hook is a convenience for rendering, never a
 * security boundary: every protected operation is authorized again on the server.
 */
export function useSession(): SessionState {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void fetchSession().then((session) => {
      if (!active) {
        return;
      }

      setUser(session);
      setLoading(false);

      if (session === null) {
        router.replace('/login');
      }
    });

    return () => {
      active = false;
    };
  }, [router]);

  const signOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  return { user, loading, signOut };
}
