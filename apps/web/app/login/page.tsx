'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { apiFetch } from '../lib/api';

const page: CSSProperties = {
  maxWidth: 380,
  margin: '80px auto',
  padding: 24,
  fontFamily: 'system-ui, sans-serif',
};

const input: CSSProperties = {
  width: '100%',
  padding: 9,
  marginTop: 4,
  marginBottom: 14,
  border: '1px solid #d0d7de',
  borderRadius: 6,
  boxSizing: 'border-box',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.push('/google');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={page}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Sign in to IndexRocket</h1>

      {error ? (
        <div
          role="alert"
          style={{
            background: '#ffebe9',
            border: '1px solid #cf222e',
            borderRadius: 6,
            padding: 10,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={submit}>
        <label>
          Email
          <input
            style={input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            style={input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy} style={{ width: '100%', padding: 10 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        No account? <Link href="/register">Create one</Link>
      </p>
    </main>
  );
}
