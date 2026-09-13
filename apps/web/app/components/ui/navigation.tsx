'use client';

import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRef, type KeyboardEvent } from 'react';

import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';
import { Button } from './button';

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export function tabId(id: string): string {
  return `tab-${id}`;
}

export function panelId(id: string): string {
  return `panel-${id}`;
}

/** WAI-ARIA tabs: arrow keys move between tabs, the panel is labelled by its tab. */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next = -1;

    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;

    if (next >= 0) {
      event.preventDefault();
      const tab = tabs[next];

      if (tab !== undefined) {
        onChange(tab.id);
        refs.current[next]?.focus();
      }
    }
  };

  return (
    <div role="tablist" aria-label={label} className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-border', className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
              selected ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-subtle px-1.5 text-2xs font-medium text-muted tabular-nums">
                {formatNumber(tab.count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {item.href !== undefined && !last ? (
                <Link href={item.href} className="truncate transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn('truncate', last ? 'text-foreground' : '')}>
                  {item.label}
                </span>
              )}
              {!last ? <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  noun = 'results',
  disabled = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  noun?: string;
  disabled?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted"
    >
      <span className="tabular-nums">
        {total === 0
          ? `No ${noun}`
          : `Showing ${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)} ${noun}`}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" icon={ChevronLeft} onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>
          Previous
        </Button>
        <span className="tabular-nums">
          Page {formatNumber(page)} of {formatNumber(totalPages)}
        </span>
        <Button
          size="sm"
          iconRight={ChevronRight}
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
