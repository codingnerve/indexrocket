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

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });
      // Registration does not create a session; sign in as a separate step.
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.push('/google');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={page}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Create an IndexRocket account</h1>

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
          Name
          <input
            style={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
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
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <span style={{ display: 'block', marginTop: -8, marginBottom: 14, fontSize: 12, color: '#57606a' }}>
            At least 10 characters.
          </span>
        </label>
        <button type="submit" disabled={busy} style={{ width: '100%', padding: 10 }}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}
