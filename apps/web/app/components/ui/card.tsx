import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import type { Tone } from './badge';
import { Skeleton } from './feedback';

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-border bg-card shadow-xs', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-muted">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 border-t border-border bg-subtle/40 px-5 py-3', className)}>
      {children}
    </div>
  );
}

const ACCENT: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  primary: 'bg-primary-soft text-primary-soft-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** A single headline number. `value` null renders a skeleton (still loading). */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
  footer,
  className,
}: {
  label: string;
  value: ReactNode | null;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {Icon ? (
          <span className={cn('flex size-7 items-center justify-center rounded-md', ACCENT[tone])}>
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value === null ? <Skeleton className="h-7 w-16" /> : value}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </Card>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
