'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { apiFetch } from '../../../../lib/api';
import {
  card,
  ErrorNote,
  formatDate,
  GoogleBadge,
  IndexNowBadge,
  InspectionBadge,
  muted,
  shell,
  TopBar,
} from '../../../../lib/ui';
import { useSession } from '../../../../lib/useSession';

interface UrlDetail {
  id: string;
  url: string;
  normalizedUrl: string | null;
  status: string;
  httpStatus: number | null;
  finalUrl: string | null;
  contentType: string | null;
  responseTimeMs: number | null;
  redirectCount: number | null;
  robotsReachable: boolean | null;
  robotsAllowed: boolean | null;
  robotsUserAgent: string | null;
  canonical: string | null;
  canonicalType: string | null;
  sitemapFound: boolean | null;
  sitemapUrl: string | null;
  urlInSitemap: boolean | null;
  error: string | null;
  submittedAt: string | null;
  lastCheckedAt: string | null;
  lastInspectedAt: string | null;
  discovery: {
    indexNow: {
      status: string;
      submittedAt: string | null;
      responseCode: number | null;
      lastError: string | null;
    };
  };
  googleInspection: {
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
    inspectedAt: string | null;
  } | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td style={{ padding: '5px 12px 5px 0', ...muted, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {label}
      </td>
      <td style={{ padding: '5px 0', wordBreak: 'break-all' }}>{children}</td>
    </tr>
  );
}

function text(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
}

export default function UrlDetailPage() {
  const params = useParams<{ id: string; urlId: string }>();
  const { user, loading, signOut } = useSession();
  const [detail, setDetail] = useState<UrlDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      const json = await apiFetch<{ data: UrlDetail }>(
        `/api/projects/${params.id}/urls/${params.urlId}`,
      );
      setDetail(json.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the URL.');
    } finally {
      setBusy(false);
    }
  }, [params.id, params.urlId]);

  useEffect(() => {
    if (user !== null) {
      void load();
    }
  }, [user, load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');

    try {
      await fn();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
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

  const google = detail?.googleInspection ?? null;

  return (
    <main style={shell}>
      <TopBar email={user.email} onSignOut={() => void signOut()} />

      <div style={{ marginBottom: 8 }}>
        <Link href={`/projects/${params.id}`} style={muted}>
          ← Back to project
        </Link>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {detail === null ? (
        <p>Loading URL…</p>
      ) : (
        <>
          <h1 style={{ fontSize: 20, wordBreak: 'break-all', marginBottom: 6 }}>{detail.url}</h1>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <InspectionBadge status={detail.status} />
            <GoogleBadge status={detail.googleInspection?.status} />
            <IndexNowBadge status={detail.discovery.indexNow.status} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await apiFetch('/api/urls/inspect', {
                    method: 'POST',
                    body: JSON.stringify({ projectId: params.id, url: detail.url }),
                  });
                })
              }
            >
              Inspect
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await apiFetch(`/api/urls/${detail.id}/discover`, { method: 'POST' });
                })
              }
            >
              Discover (IndexNow)
            </button>
            <Link href="/google">
              <button disabled={busy}>Google inspect</button>
            </Link>
          </div>

          <section style={card}>
            <strong>Our inspection</strong>
            <p style={{ ...muted, fontSize: 12, marginTop: 2 }}>What IndexRocket measured itself.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                <Row label="HTTP status">{text(detail.httpStatus)}</Row>
                <Row label="Final URL">{text(detail.finalUrl)}</Row>
                <Row label="Redirects">{text(detail.redirectCount)}</Row>
                <Row label="Content type">{text(detail.contentType)}</Row>
                <Row label="Response time">
                  {detail.responseTimeMs === null ? '—' : `${detail.responseTimeMs} ms`}
                </Row>
                <Row label="Canonical">{text(detail.canonical)}</Row>
                <Row label="Canonical type">{text(detail.canonicalType)}</Row>
                <Row label="robots.txt reachable">{text(detail.robotsReachable)}</Row>
                <Row label="robots.txt allows">{text(detail.robotsAllowed)}</Row>
                <Row label="Evaluated for">{text(detail.robotsUserAgent)}</Row>
                <Row label="Sitemap found">{text(detail.sitemapFound)}</Row>
                <Row label="Sitemap URL">{text(detail.sitemapUrl)}</Row>
                <Row label="URL in sitemap">{text(detail.urlInSitemap)}</Row>
                <Row label="Inspected at">{formatDate(detail.lastInspectedAt)}</Row>
                <Row label="Error">{text(detail.error)}</Row>
              </tbody>
            </table>
          </section>

          <section style={card}>
            <strong>Google Search Console</strong>
            <p style={{ ...muted, fontSize: 12, marginTop: 2 }}>
              Reported by Google. This is the only source that can say a URL is on Google.
            </p>
            {google === null ? (
              <p style={muted}>Not inspected with Google yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <tbody>
                  <Row label="Verdict">{text(google.verdict)}</Row>
                  <Row label="Coverage state">{text(google.coverageState)}</Row>
                  <Row label="Indexing state">{text(google.indexingState)}</Row>
                  <Row label="robots.txt state">{text(google.robotsTxtState)}</Row>
                  <Row label="Page fetch state">{text(google.pageFetchState)}</Row>
                  <Row label="Last crawl">{text(google.lastCrawlTime)}</Row>
                  <Row label="Crawled as">{text(google.crawledAs)}</Row>
                  <Row label="Google canonical">{text(google.googleCanonical)}</Row>
                  <Row label="User canonical">{text(google.userCanonical)}</Row>
                  <Row label="Inspected at">{formatDate(google.inspectedAt)}</Row>
                </tbody>
              </table>
            )}
          </section>

          <section style={card}>
            <strong>IndexNow discovery</strong>
            <p style={{ ...muted, fontSize: 12, marginTop: 2 }}>
              Whether a notification was accepted. Acceptance is not indexing.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                <Row label="Status">{text(detail.discovery.indexNow.status)}</Row>
                <Row label="Submitted at">{formatDate(detail.discovery.indexNow.submittedAt)}</Row>
                <Row label="Response code">{text(detail.discovery.indexNow.responseCode)}</Row>
                <Row label="Last error">{text(detail.discovery.indexNow.lastError)}</Row>
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
