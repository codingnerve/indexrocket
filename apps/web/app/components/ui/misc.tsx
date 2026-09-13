'use client';

import { Check, Copy, ExternalLink, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { formatNumber, percentOf } from '../../lib/format';
import { toneDotClass, type Tone } from './badge';
import { Breadcrumbs } from './navigation';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 space-y-3">
      {typeof title === 'string' ? <title>{`${title} · IndexRocket`}</title> : null}
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
          {meta ? <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-subtle hover:text-foreground',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

/**
 * A long URL that never breaks the layout: truncated, full value in the
 * tooltip, with an optional copy button and link.
 */
export function UrlText({
  url,
  href,
  external = false,
  copy = false,
  className,
}: {
  url: string;
  href?: string;
  external?: boolean;
  copy?: boolean;
  className?: string;
}) {
  const display = url.replace(/^https?:\/\//, '');
  const text = <span className="truncate">{display}</span>;

  return (
    <span className={cn('group/url flex min-w-0 items-center gap-1', className)} title={url}>
      {href !== undefined ? (
        external ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-w-0 items-center gap-1 font-medium text-foreground hover:text-primary"
          >
            {text}
            <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </a>
        ) : (
          <Link href={href} className="flex min-w-0 font-medium text-foreground hover:text-primary">
            {text}
          </Link>
        )
      ) : (
        text
      )}
      {copy ? (
        <CopyButton value={url} label="Copy URL" className="opacity-0 group-hover/url:opacity-100 focus-visible:opacity-100" />
      ) : null}
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-md border border-border bg-card pr-8 pl-8.5 text-sm text-foreground shadow-xs placeholder:text-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== '' ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

const BAR_TONES: Record<Tone, string> = {
  neutral: 'bg-border-strong',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface Segment {
  label: string;
  value: number;
  tone: Tone;
}

/**
 * A single horizontal bar split into proportional segments, with a legend.
 * Used to show real current-state distributions; with no data it says so
 * instead of drawing an empty chart.
 */
export function SegmentedBar({
  segments,
  label,
  showLegend = true,
  size = 'md',
}: {
  segments: Segment[];
  label: string;
  showLegend?: boolean;
  size?: 'sm' | 'md';
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const summary = segments.map((segment) => `${segment.label}: ${segment.value}`).join(', ');

  return (
    <div>
      <div
        role="img"
        aria-label={`${label}. ${total === 0 ? 'No data yet.' : summary}`}
        className={cn('flex w-full overflow-hidden rounded-full bg-subtle', size === 'sm' ? 'h-1.5' : 'h-2.5')}
      >
        {total > 0
          ? segments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <span
                  key={segment.label}
                  className={cn('h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full', BAR_TONES[segment.tone])}
                  style={{ width: `${percentOf(segment.value, total) ?? 0}%` }}
                />
              ))
          : null}
      </div>
      {showLegend ? (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {segments.map((segment) => (
            <li key={segment.label} className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', toneDotClass(segment.tone))} aria-hidden="true" />
              <span className="text-muted">{segment.label}</span>
              <span className="font-medium text-foreground tabular-nums">{formatNumber(segment.value)}</span>
              {total > 0 ? (
                <span className="text-xs text-muted tabular-nums">{Math.round(percentOf(segment.value, total) ?? 0)}%</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  label,
  tone = 'primary',
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const percent = max <= 0 ? 0 : Math.min(100, (value / max) * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-subtle', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', BAR_TONES[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Two-column label/value list. Rows whose value is null are hidden. */
export function DetailList({ items, className }: { items: Array<{ label: string; value: ReactNode | null | undefined }>; className?: string }) {
  const visible = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== '');

  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {visible.map((item) => (
        <div key={item.label} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-[13px] text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small tooltip for supplementary explanations (never the only way to get information). */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-4 text-background opacity-0 shadow-lg transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
