import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from './button';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <LoaderCircle
      className={cn('size-4 animate-spin text-muted', className)}
      aria-hidden={label === undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-subtle', className)} />;
}

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2.5 py-12 text-sm text-muted', className)}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Placeholder rows shaped like a table while data loads. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} className={cn('h-4', column === 0 ? 'w-2/5' : 'w-1/6')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-subtle text-muted">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-5 text-muted">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Couldn’t load this',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="flex size-11 items-center justify-center rounded-lg bg-danger-soft text-danger">
        <CircleAlert className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-5" size="sm" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_STYLES: Record<AlertTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info', Icon: Info },
  success: { box: 'border-success/25 bg-success-soft', icon: 'text-success', Icon: CircleCheck },
  warning: { box: 'border-warning/25 bg-warning-soft', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'border-danger/25 bg-danger-soft', icon: 'text-danger', Icon: CircleAlert },
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const style = ALERT_STYLES[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px] leading-5', style.box, className)}
    >
      <style.Icon className={cn('mt-0.5 size-4 shrink-0', style.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-foreground">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5 text-muted' : '')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
