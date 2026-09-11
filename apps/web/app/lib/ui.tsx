'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export const shell: CSSProperties = {
  maxWidth: 1080,
  margin: '32px auto',
  padding: '0 20px 64px',
  fontFamily: 'system-ui, sans-serif',
};

export const card: CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

export const field: CSSProperties = {
  width: '100%',
  padding: 8,
  marginTop: 4,
  border: '1px solid #d0d7de',
  borderRadius: 6,
  boxSizing: 'border-box',
};

export const muted: CSSProperties = { color: '#57606a' };

/**
 * Status vocabulary.
 *
 * The three families are rendered with deliberately different wording so a
 * reader is never invited to equate them. An accepted IndexNow notification is
 * labelled "Notified", never "Indexed": only Google's own verdict can say a URL
 * is on Google. See docs/DISCOVERY.md.
 */
type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info';

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: '#f6f8fa', fg: '#57606a', border: '#d0d7de' },
  good: { bg: '#dafbe1', fg: '#0a5c2e', border: '#4ac26b' },
  bad: { bg: '#ffebe9', fg: '#a40e26', border: '#ff8182' },
  warn: { bg: '#fff8c5', fg: '#7d4e00', border: '#d4a72c' },
  info: { bg: '#ddf4ff', fg: '#0550ae', border: '#54aeff' },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const colors = TONES[tone];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

export function InspectionBadge({ status }: { status: string }) {
  switch (status) {
    case 'inspected':
      return <Badge label="Inspected" tone="good" />;
    case 'failed':
      return <Badge label="Failed" tone="bad" />;
    case 'processing':
      return <Badge label="Processing" tone="info" />;
    default:
      return <Badge label="Pending" tone="neutral" />;
  }
}

export function GoogleBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case 'indexed':
      return <Badge label="Indexed" tone="good" />;
    case 'not_indexed':
      return <Badge label="Not indexed" tone="bad" />;
    case 'unknown':
    case 'error':
      return <Badge label="Unknown" tone="warn" />;
    default:
      return <Badge label="Not inspected" tone="neutral" />;
  }
}

/**
 * IndexNow wording is deliberately about the NOTIFICATION, not about indexing.
 */
export function IndexNowBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case 'accepted':
      return <Badge label="Notified" tone="info" />;
    case 'failed':
      return <Badge label="Failed" tone="bad" />;
    case 'pending':
      return <Badge label="Sending" tone="warn" />;
    default:
      return <Badge label="Not submitted" tone="neutral" />;
  }
}

export function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div style={{ ...card, marginBottom: 0, flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div style={{ ...muted, fontSize: 13, marginTop: 4 }}>{label}</div>
      {hint ? <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

export function TopBar({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 20,
        flexWrap: 'wrap',
      }}
    >
      <nav style={{ display: 'flex', gap: 14 }}>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/google">Search Console</Link>
      </nav>
      <span style={muted}>
        {email} · <button onClick={onSignOut}>Sign out</button>
      </span>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      style={{ ...card, background: '#ffebe9', borderColor: '#cf222e', marginBottom: 16 }}
    >
      {children}
    </div>
  );
}

export function formatDate(value: string | null): string {
  if (value === null) {
    return '—';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
