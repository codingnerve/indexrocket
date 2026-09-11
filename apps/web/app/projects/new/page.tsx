'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiFetch } from '../../lib/api';
import { card, ErrorNote, field, muted, shell, TopBar } from '../../lib/ui';
import { useSession } from '../../lib/useSession';

export default function NewProjectPage() {
  const router = useRouter();
  const { user, loading, signOut } = useSession();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const json = await apiFetch<{ data: { id: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, domain }),
      });
      router.push(`/projects/${json.data.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <main style={shell}>Loading…</main>;
  }

  if (user === null) {
    return <main style={shell}>Redirecting to sign in…</main>;
  }

  return (
    <main style={shell}>
      <TopBar email={user.email} onSignOut={() => void signOut()} />

      <h1 style={{ fontSize: 24 }}>New project</h1>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <form onSubmit={submit} style={{ ...card, maxWidth: 520 }}>
        <label>
          Name
          <input
            style={field}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My site"
            required
          />
        </label>

        <label style={{ display: 'block', marginTop: 14 }}>
          Domain
          <input
            style={field}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            required
          />
        </label>
        <p style={{ ...muted, fontSize: 12, marginTop: 6 }}>
          A hostname such as <code>example.com</code>. A pasted URL is accepted and reduced to its
          host; <code>www.</code> is stripped because it is treated as the same site. Anything that
          is not a valid hostname is rejected rather than guessed at.
        </p>

        <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </main>
  );
}
