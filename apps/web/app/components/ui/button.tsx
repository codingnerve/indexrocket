import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
  secondary: 'border-border bg-card text-foreground shadow-xs hover:bg-subtle',
  ghost: 'border-transparent text-muted hover:bg-subtle hover:text-foreground',
  danger: 'border-transparent bg-danger text-white shadow-xs hover:brightness-110',
  'danger-ghost': 'border-transparent text-danger hover:bg-danger-soft',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-10 gap-2 px-4 text-sm',
};

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'size-3.5', md: 'size-4', lg: 'size-4' };

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap rounded-md border font-medium transition-[color,background-color,box-shadow,filter] disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading ? (
        <LoaderCircle className={cn(ICON_SIZES[size], 'animate-spin')} aria-hidden="true" />
      ) : Icon ? (
        <Icon className={ICON_SIZES[size]} aria-hidden="true" />
      ) : null}
      {children}
      {IconRight && !loading ? <IconRight className={ICON_SIZES[size]} aria-hidden="true" /> : null}
    </button>
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...props
}: Omit<CommonProps, 'loading'> & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {Icon ? <Icon className={ICON_SIZES[size]} aria-hidden="true" /> : null}
      {children}
      {IconRight ? <IconRight className={ICON_SIZES[size]} aria-hidden="true" /> : null}
    </Link>
  );
}

/** Icon-only button. `label` is required: it is the accessible name and the tooltip. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'sm',
  loading = false,
  disabled,
  className,
  type = 'button',
  ...props
}: {
  icon: LucideIcon;
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled === true || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        size === 'sm' ? 'size-8' : 'size-9',
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
