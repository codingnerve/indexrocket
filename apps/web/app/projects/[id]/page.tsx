'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../../lib/api';
import {
  card,
  ErrorNote,
  field,
  formatDate,
  GoogleBadge,
  IndexNowBadge,
  InspectionBadge,
  muted,
  shell,
  Stat,
  TopBar,
} from '../../lib/ui';
import { useSession } from '../../lib/useSession';

interface Project {
  id: string;
  name: string;
  domain: string;
  hasIndexNowKey: boolean;
}

interface Summary {
  totalUrls: number;
  inspection: { pending: number; inspected: number; failed: number };
  google: { indexed: number; notIndexed: number; unknown: number; notInspected: number };
  indexNow: { accepted: number; failed: number; pending: number; notSubmitted: number };
}

interface UrlRow {
  id: string;
  url: string;
  status: string;
  httpStatus: number | null;
  lastCheckedAt: string | null;
  discovery: { indexNow: { status: string } };
  googleInspection: { status: string } | null;
}

interface Pagination {
  page: number;
  totalPages: number;
  total: number;
  hasMore: boolean;
}

const STATUS_OPTIONS = ['all', 'queued', 'processing', 'inspected', 'failed'];

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const router = useRouter();
  const { user, loading, signOut } = useSession();

  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [urls, setUrls] = useState<UrlRow[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [singleUrl, setSingleUrl] = useState('');
  const [bulkUrls, setBulkUrls] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batches, setBatches] = useState<Array<{ id: string; status: string; total: number; completed: number; failed: number; skipped: number; createdAt: string }>>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProject = useCallback(async () => {
    const [projectJson, summaryJson] = await Promise.all([
      apiFetch<{ data: Project }>(`/api/projects/${projectId}`),
      apiFetch<{ data: Summary }>(`/api/projects/${projectId}/summary`),
    ]);

    setProject(projectJson.data);
    setSummary(summaryJson.data);

    const batchJson = await apiFetch<{ data: typeof batches }>(
      `/api/projects/${projectId}/batches?limit=5`,
    );
    setBatches(batchJson.data);
  }, [projectId]);

  const loadUrls = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), limit: '25' });

    if (search.trim() !== '') {
      query.set('search', search.trim());
    }

    if (status !== 'all') {
      query.set('status', status);
    }

    const json = await apiFetch<{ data: UrlRow[]; pagination: Pagination }>(
      `/api/projects/${projectId}/urls?${query.toString()}`,
    );

    setUrls(json.data);
    setPagination(json.pagination);
  }, [projectId, page, search, status]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      await Promise.all([loadProject(), loadUrls()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the project.');
    } finally {
      setBusy(false);
    }
  }, [loadProject, loadUrls]);

  useEffect(() => {
    if (user !== null) {
      void refresh();
    }
  }, [user, refresh]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNote('');

    try {
      setNote(await fn());
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const addUrl = () =>
    run(async () => {
      const json = await apiFetch<{ created: boolean }>(`/api/projects/${projectId}/urls`, {
        method: 'POST',
        body: JSON.stringify({ url: singleUrl }),
      });
      setSingleUrl('');

      return json.created ? 'URL added.' : 'URL was already tracked by this project.';
    });

  const addBulk = () =>
    run(async () => {
      const list = bulkUrls
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

      const json = await apiFetch<{
        summary: { submitted: number; created: number; duplicates: number; rejected: number };
      }>(`/api/projects/${projectId}/urls/bulk`, {
        method: 'POST',
        body: JSON.stringify({ urls: list }),
      });

      setBulkUrls('');

      return `Imported ${json.summary.created}, ${json.summary.duplicates} duplicate, ${json.summary.rejected} rejected.`;
    });

  const inspect = (row: UrlRow) =>
    run(async () => {
      await apiFetch(`/api/urls/inspect`, {
        method: 'POST',
        body: JSON.stringify({ projectId, url: row.url }),
      });

      return 'Inspection queued.';
    });

  const discover = (row: UrlRow) =>
    run(async () => {
      await apiFetch(`/api/urls/${row.id}/discover`, { method: 'POST' });

      return 'Discovery notification queued.';
    });

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const pageIds = urls.map((row) => row.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleAllOnPage = () => {
    setSelected((current) => {
      const next = new Set(current);

      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }

      return next;
    });
  };

  const submitSelected = () =>
    run(async () => {
      const urlIds = [...selected];

      // A large submission is confirmed first: it queues real provider work.
      if (urlIds.length > 10 && !window.confirm(`Submit ${urlIds.length} URLs for inspection and IndexNow notification?`)) {
        return 'Cancelled.';
      }

      const json = await apiFetch<{ data: { id: string }; summary: { queued: number; alreadyInFlight: number } }>(
        `/api/projects/${projectId}/batches`,
        { method: 'POST', body: JSON.stringify({ urlIds }) },
      );

      setSelected(new Set());
      router.push(`/projects/${projectId}/batches/${json.data.id}`);

      return `Queued ${json.summary.queued} URL(s).`;
    });

  const remove = (row: UrlRow) =>
    run(async () => {
      await apiFetch(`/api/projects/${projectId}/urls/${row.id}`, { method: 'DELETE' });

      return 'URL deleted.';
    });

  if (loading) {
    return <main style={shell}>Loading…</main>;
  }

  if (user === null) {
    return <main style={shell}>Redirecting to sign in…</main>;
  }

  const cell: React.CSSProperties = { padding: '8px 10px', borderTop: '1px solid #d0d7de', fontSize: 13 };

  return (
    <main style={shell}>
      <TopBar email={user.email} onSignOut={() => void signOut()} />

      <div style={{ marginBottom: 8 }}>
        <Link href="/dashboard" style={muted}>
          ← All projects
        </Link>
      </div>

      <h1 style={{ fontSize: 24, marginBottom: 2 }}>{project?.name ?? 'Project'}</h1>
      <p style={{ ...muted, marginTop: 0 }}>
        {project?.domain}
        {project ? (project.hasIndexNowKey ? ' · IndexNow key configured' : ' · no IndexNow key') : ''}
      </p>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <div style={{ ...card, background: '#dafbe1', borderColor: '#4ac26b' }}>{note}</div> : null}

      {summary ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <Stat label="URLs" value={summary.totalUrls} />
          <Stat label="Inspected" value={summary.inspection.inspected} hint="our own measurement" />
          <Stat label="Inspection failed" value={summary.inspection.failed} />
          <Stat label="Indexed" value={summary.google.indexed} hint="Google's verdict" />
          <Stat label="Not indexed" value={summary.google.notIndexed} hint="Google's verdict" />
          <Stat label="Notified" value={summary.indexNow.accepted} hint="IndexNow accepted" />
        </div>
      ) : null}

      <section style={card}>
        <strong>Add a URL</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            style={{ ...field, flex: '1 1 320px', marginTop: 0 }}
            value={singleUrl}
            onChange={(event) => setSingleUrl(event.target.value)}
            placeholder={`https://${project?.domain ?? 'example.com'}/page`}
          />
          <button onClick={() => void addUrl()} disabled={busy || singleUrl.trim() === ''}>
            Add
          </button>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary>Bulk import</summary>
          <textarea
            style={{ ...field, minHeight: 110, fontFamily: 'monospace' }}
            value={bulkUrls}
            onChange={(event) => setBulkUrls(event.target.value)}
            placeholder={'One URL per line\nhttps://example.com/a\nhttps://example.com/b'}
          />
          <button onClick={() => void addBulk()} disabled={busy || bulkUrls.trim() === ''}>
            Import
          </button>
          <span style={{ ...muted, fontSize: 12, marginLeft: 8 }}>
            Up to 500 per request. Adding a URL does not inspect it.
          </span>
        </details>
      </section>

      {batches.length > 0 ? (
        <section style={card}>
          <strong>Recent submissions</strong>
          <div style={{ marginTop: 8 }}>
            {batches.map((entry) => (
              <div key={entry.id} style={{ fontSize: 13, padding: '4px 0' }}>
                <Link href={`/projects/${projectId}/batches/${entry.id}`}>
                  {new Date(entry.createdAt).toLocaleString()}
                </Link>{' '}
                <span style={muted}>
                  — {entry.status} · {entry.completed}/{entry.total} completed
                  {entry.failed > 0 ? `, ${entry.failed} failed` : ''}
                  {entry.skipped > 0 ? `, ${entry.skipped} skipped` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ ...card, padding: 0 }}>
        <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...field, flex: '1 1 220px', marginTop: 0 }}
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search URLs"
          />
          <select
            style={{ ...field, width: 'auto', marginTop: 0 }}
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All statuses' : option}
              </option>
            ))}
          </select>
          <button onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '0 12px 12px',
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
          <button onClick={() => void submitSelected()} disabled={busy || selected.size === 0}>
            Submit selected
          </button>
          <button onClick={() => setSelected(new Set())} disabled={busy || selected.size === 0}>
            Clear selection
          </button>
          <span style={{ ...muted, fontSize: 12 }}>
            Submitting runs inspection, then an IndexNow notification where eligible. Google indexing
            status is a separate check.
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, ...muted }}>
                <th style={{ padding: '8px 10px', width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    aria-label="Select all on this page"
                  />
                </th>
                <th style={{ padding: '8px 10px' }}>URL</th>
                <th style={{ padding: '8px 10px' }}>HTTP</th>
                <th style={{ padding: '8px 10px' }}>Inspection</th>
                <th style={{ padding: '8px 10px' }}>Google</th>
                <th style={{ padding: '8px 10px' }}>IndexNow</th>
                <th style={{ padding: '8px 10px' }}>Last checked</th>
                <th style={{ padding: '8px 10px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {urls.map((row) => (
                <tr key={row.id}>
                  <td style={cell}>
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.url}`}
                    />
                  </td>
                  <td style={{ ...cell, maxWidth: 320, wordBreak: 'break-all' }}>
                    <Link href={`/projects/${projectId}/urls/${row.id}`}>{row.url}</Link>
                  </td>
                  <td style={cell}>{row.httpStatus ?? '—'}</td>
                  <td style={cell}>
                    <InspectionBadge status={row.status} />
                  </td>
                  <td style={cell}>
                    <GoogleBadge status={row.googleInspection?.status} />
                  </td>
                  <td style={cell}>
                    <IndexNowBadge status={row.discovery.indexNow.status} />
                  </td>
                  <td style={cell}>{formatDate(row.lastCheckedAt)}</td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <button onClick={() => void inspect(row)} disabled={busy}>
                      Inspect
                    </button>{' '}
                    <button onClick={() => void discover(row)} disabled={busy}>
                      Discover
                    </button>{' '}
                    <button onClick={() => void remove(row)} disabled={busy}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {urls.length === 0 ? (
                <tr>
                  <td style={{ ...cell, ...muted }} colSpan={8}>
                    No URLs match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {pagination ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, ...muted, fontSize: 13 }}>
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={busy || page <= 1}>
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} URLs
            </span>
            <button onClick={() => setPage((value) => value + 1)} disabled={busy || !pagination.hasMore}>
              Next
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
