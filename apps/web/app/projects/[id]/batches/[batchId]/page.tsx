'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../../lib/api';
import {
  Badge,
  card,
  ErrorNote,
  formatDate,
  muted,
  shell,
  Stat,
  TopBar,
} from '../../../../lib/ui';
import { useSession } from '../../../../lib/useSession';

interface Batch {
  id: string;
  status: string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  inspectGoogle: boolean;
  googleSiteUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface Item {
  id: string;
  url: string;
  status: string;
  inspectionStatus: string;
  discoveryStatus: string;
  googleStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  notes: string[];
  attempts: number;
  completedAt: string | null;
}

const TERMINAL = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

/** Poll while the batch is live; stop the moment it reaches a terminal state. */
const POLL_MS = 3000;

function BatchBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <Badge label="Completed" tone="good" />;
    case 'completed_with_errors':
      return <Badge label="Completed with errors" tone="warn" />;
    case 'failed':
      return <Badge label="Failed" tone="bad" />;
    case 'cancelled':
      return <Badge label="Cancelled" tone="neutral" />;
    case 'processing':
      return <Badge label="Processing" tone="info" />;
    default:
      return <Badge label="Pending" tone="neutral" />;
  }
}

/**
 * Stage wording is deliberately distinct per column. "Notified" is never
 * rendered as "Indexed": only the Google column can say that, and only from a
 * Google Search Console result.
 */
function StageBadge({ stage, outcome }: { stage: 'inspection' | 'discovery' | 'google'; outcome: string }) {
  if (outcome === 'succeeded') {
    const label = stage === 'inspection' ? 'Inspected' : stage === 'discovery' ? 'Notified' : 'Checked';

    return <Badge label={label} tone={stage === 'google' ? 'good' : stage === 'discovery' ? 'info' : 'good'} />;
  }

  if (outcome === 'failed') {
    return <Badge label="Failed" tone="bad" />;
  }

  if (outcome === 'skipped') {
    return <Badge label="Skipped" tone="warn" />;
  }

  return <Badge label="Not run" tone="neutral" />;
}

export default function BatchDetailPage() {
  const params = useParams<{ id: string; batchId: string }>();
  const { user, loading, signOut } = useSession();

  const [batch, setBatch] = useState<Batch | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const [batchJson, itemsJson] = await Promise.all([
      apiFetch<{ data: Batch }>(`/api/projects/${params.id}/batches/${params.batchId}`),
      apiFetch<{ data: Item[] }>(`/api/projects/${params.id}/batches/${params.batchId}/items?limit=100`),
    ]);

    setBatch(batchJson.data);
    setItems(itemsJson.data);

    return batchJson.data;
  }, [params.id, params.batchId]);

  useEffect(() => {
    if (user === null) {
      return;
    }

    let active = true;

    const tick = async () => {
      try {
        const current = await load();

        // Polling stops at a terminal state; it never runs indefinitely.
        if (active && !TERMINAL.includes(current.status)) {
          timer.current = setTimeout(() => void tick(), POLL_MS);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load the batch.');
        }
      }
    };

    void tick();

    return () => {
      active = false;

      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [user, load]);

  const cancel = async () => {
    setBusy(true);
    setError('');

    try {
      await apiFetch(`/api/projects/${params.id}/batches/${params.batchId}/cancel`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel the batch.');
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

  const cell: React.CSSProperties = {
    padding: '8px 10px',
    borderTop: '1px solid #d0d7de',
    fontSize: 13,
    verticalAlign: 'top',
  };

  const live = batch !== null && !TERMINAL.includes(batch.status);

  return (
    <main style={shell}>
      <TopBar email={user.email} onSignOut={() => void signOut()} />

      <div style={{ marginBottom: 8 }}>
        <Link href={`/projects/${params.id}`} style={muted}>
          ← Back to project
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Submission batch</h1>
        {batch ? <BatchBadge status={batch.status} /> : null}
        {live ? <span style={{ ...muted, fontSize: 12 }}>updating live…</span> : null}
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {batch ? (
        <>
          <p style={{ ...muted, marginTop: 6 }}>
            Created {formatDate(batch.createdAt)} · Started {formatDate(batch.startedAt)} · Finished{' '}
            {formatDate(batch.completedAt)}
            {batch.inspectGoogle ? ` · Google inspection on (${batch.googleSiteUrl ?? 'no property'})` : ''}
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
            <Stat label="Total" value={batch.total} />
            <Stat label="Pending" value={batch.pending} />
            <Stat label="Processing" value={batch.processing} />
            <Stat label="Completed" value={batch.completed} />
            <Stat label="Failed" value={batch.failed} />
            <Stat label="Skipped" value={batch.skipped} />
          </div>

          {live ? (
            <button onClick={() => void cancel()} disabled={busy} style={{ marginBottom: 16 }}>
              Cancel remaining
            </button>
          ) : null}

          <p style={{ ...muted, fontSize: 12 }}>
            Cancelling stops URLs that have not started. A URL already in flight finishes, and an
            IndexNow notification that was already sent cannot be recalled.
          </p>
        </>
      ) : (
        <p>Loading batch…</p>
      )}

      <section style={{ ...card, padding: 0, marginTop: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', fontSize: 12, ...muted }}>
                <th style={{ padding: '8px 10px' }}>URL</th>
                <th style={{ padding: '8px 10px' }}>Result</th>
                <th style={{ padding: '8px 10px' }}>Inspection</th>
                <th style={{ padding: '8px 10px' }}>IndexNow</th>
                <th style={{ padding: '8px 10px' }}>Google</th>
                <th style={{ padding: '8px 10px' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ ...cell, maxWidth: 280, wordBreak: 'break-all' }}>{item.url}</td>
                  <td style={cell}>
                    {item.status === 'completed' ? (
                      <Badge label="Completed" tone="good" />
                    ) : item.status === 'failed' ? (
                      <Badge label="Failed" tone="bad" />
                    ) : item.status === 'skipped' ? (
                      <Badge label="Skipped" tone="warn" />
                    ) : item.status === 'processing' ? (
                      <Badge label="Processing" tone="info" />
                    ) : (
                      <Badge label="Pending" tone="neutral" />
                    )}
                  </td>
                  <td style={cell}>
                    <StageBadge stage="inspection" outcome={item.inspectionStatus} />
                  </td>
                  <td style={cell}>
                    <StageBadge stage="discovery" outcome={item.discoveryStatus} />
                  </td>
                  <td style={cell}>
                    <StageBadge stage="google" outcome={item.googleStatus} />
                  </td>
                  <td style={{ ...cell, fontSize: 12, maxWidth: 320 }}>
                    {item.errorMessage ? (
                      <div style={{ color: '#a40e26' }}>{item.errorMessage}</div>
                    ) : null}
                    {item.notes.map((note, index) => (
                      <div key={index} style={muted}>
                        {note}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td style={{ ...cell, ...muted }} colSpan={6}>
                    No items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ ...muted, fontSize: 12 }}>
        &quot;Notified&quot; means an IndexNow notification was accepted by the provider. It is not a
        statement about Google indexing; only the Google column reflects Google&apos;s own report.
      </p>
    </main>
  );
}
