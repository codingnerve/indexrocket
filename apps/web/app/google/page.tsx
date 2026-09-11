'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { apiFetch, fetchSession, type SessionUser } from '../lib/api';

interface ConnectionView {
  connected: boolean;
  status: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
}

interface Property {
  siteUrl: string;
  permissionLevel: string;
}

interface Snapshot {
  status: string;
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  inspectionResultLink: string | null;
  inspectedAt: string;
}

const box: CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const input: CSSProperties = {
  width: '100%',
  padding: 8,
  marginTop: 4,
  border: '1px solid #d0d7de',
  borderRadius: 6,
};

/**
 * Minimal development harness proving the Search Console flow end to end.
 * Deliberately plain: the real dashboard is a later step.
 */
export default function GooglePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [siteUrl, setSiteUrl] = useState('');
  const [inspectionUrl, setInspectionUrl] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The session cookie is HttpOnly, so membership is confirmed by asking the API.
    void fetchSession().then((user) => {
      setSession(user);
      setLoadingSession(false);

      if (user === null) {
        router.replace('/login');
      }
    });

    const params = new URLSearchParams(window.location.search);

    if (params.get('connected') === 'true') {
      setMessage('Google account connected.');
    }

    const error = params.get('error');

    if (error) {
      setMessage(`Google returned an error: ${error}`);
    }
  }, [router]);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => await apiFetch<any>(path, init),
    [],
  );

  const signOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');

    try {
      await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const checkConnection = () =>
    run(async () => {
      const json = await call('/api/google/connection');
      setConnection(json.data);
    });

  const connect = () =>
    run(async () => {
      const json = await call('/api/auth/google/start');
      window.location.href = json.authorizationUrl;
    });

  const disconnect = () =>
    run(async () => {
      await call('/api/google/connection', { method: 'DELETE' });
      setConnection(null);
      setProperties([]);
      setMessage('Disconnected.');
    });

  const loadProperties = () =>
    run(async () => {
      const json = await call('/api/google/search-console/properties');
      setProperties(json.data);

      if (json.data.length > 0 && siteUrl === '') {
        setSiteUrl(json.data[0].siteUrl);
      }
    });

  const inspect = () =>
    run(async () => {
      const json = await call('/api/google/search-console/inspect', {
        method: 'POST',
        body: JSON.stringify({ inspectionUrl, siteUrl }),
      });
      setSnapshot(json.data);
    });

  const rows: ReadonlyArray<readonly [string, string | null]> = snapshot
    ? [
        ['Status (mapped from Google)', snapshot.status],
        ['Verdict', snapshot.verdict],
        ['Coverage state', snapshot.coverageState],
        ['Indexing state', snapshot.indexingState],
        ['robots.txt state', snapshot.robotsTxtState],
        ['Page fetch state', snapshot.pageFetchState],
        ['Last crawl', snapshot.lastCrawlTime],
        ['Crawled as', snapshot.crawledAs],
        ['Google canonical', snapshot.googleCanonical],
        ['User canonical', snapshot.userCanonical],
        ['Inspected at', snapshot.inspectedAt],
      ]
    : [];

  if (loadingSession) {
    return <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</main>;
  }

  if (session === null) {
    return <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Redirecting to sign in…</main>;
  }

  return (
    <main style={{ maxWidth: 780, margin: '40px auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ color: '#57606a' }}>
          Signed in as <strong>{session?.email ?? '…'}</strong>
        </span>
        <button onClick={() => void signOut()}>Sign out</button>
      </div>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Google Search Console</h1>
      <p style={{ color: '#57606a', marginTop: 0 }}>
        Development harness. A Google verdict comes from Google alone and is separate from our own URL
        inspection and from IndexNow notification state.
      </p>

      {message ? <div style={{ ...box, background: '#fff8c5', borderColor: '#d4a72c' }}>{message}</div> : null}

      <section style={box}>
        <strong>1. Google connection</strong>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={checkConnection} disabled={busy}>
            Check connection
          </button>
          <button onClick={connect} disabled={busy}>
            Connect Google Search Console
          </button>
          <button onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        </div>
        {connection ? (
          <p style={{ marginBottom: 0 }}>
            Status: <strong>{connection.connected ? 'connected' : connection.status ?? 'not connected'}</strong>
            {connection.expiresAt ? <> · token expires {new Date(connection.expiresAt).toLocaleString()}</> : null}
            {connection.scopes.length > 0 ? <> · scopes: {connection.scopes.join(', ')}</> : null}
          </p>
        ) : null}
      </section>

      <section style={box}>
        <strong>2. Properties</strong>
        <div style={{ marginTop: 8 }}>
          <button onClick={loadProperties} disabled={busy}>
            Load properties
          </button>
        </div>
        {properties.length > 0 ? (
          <label style={{ display: 'block', marginTop: 12 }}>
            Property
            <select style={input} value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)}>
              {properties.map((property) => (
                <option key={property.siteUrl} value={property.siteUrl}>
                  {property.siteUrl} ({property.permissionLevel})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section style={box}>
        <strong>3. Inspect a URL</strong>
        <label style={{ display: 'block', marginTop: 8 }}>
          URL
          <input
            style={input}
            value={inspectionUrl}
            onChange={(event) => setInspectionUrl(event.target.value)}
            placeholder="https://example.com/page"
          />
        </label>
        <div style={{ marginTop: 12 }}>
          <button onClick={inspect} disabled={busy || !siteUrl || !inspectionUrl}>
            Inspect with Google
          </button>
        </div>
      </section>

      {snapshot ? (
        <section style={box}>
          <strong>Google result</strong>
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: '4px 8px 4px 0', color: '#57606a', whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ padding: '4px 0', wordBreak: 'break-all' }}>{value ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.inspectionResultLink ? (
            <p style={{ marginBottom: 0 }}>
              <a href={snapshot.inspectionResultLink} target="_blank" rel="noreferrer">
                Open in Search Console
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
