import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  primary: 'bg-primary-soft text-primary-soft-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-muted',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  title,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-current/10 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span className="relative flex size-1.5" aria-hidden="true">
          {pulse ? <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOTS[tone])} /> : null}
          <span className={cn('relative size-1.5 rounded-full', DOTS[tone])} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function toneDotClass(tone: Tone): string {
  return DOTS[tone];
}
