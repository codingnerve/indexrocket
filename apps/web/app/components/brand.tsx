import Link from 'next/link';

import { cn } from '../lib/cn';

/** The IndexRocket mark: a rocket on the primary tile. Pure SVG, theme-aware. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M16 5.5c3.4 2.3 5.2 5.8 5.2 9.8v3.9l-2.5 2.1h-5.4l-2.5-2.1v-3.9c0-4 1.8-7.5 5.2-9.8Z"
        className="fill-primary-foreground"
      />
      <circle cx="16" cy="14.2" r="2.1" className="fill-primary" />
      <path d="M10.8 17.4 8 20.6V25l3.4-2.4ZM21.2 17.4l2.8 3.2V25l-3.4-2.4Z" className="fill-primary-foreground" />
      <path d="M14 22.6h4L16 26.8Z" className="fill-primary-foreground/60" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-[15px] font-semibold tracking-tight text-foreground', className)}>
      Index<span className="text-primary">Rocket</span>
    </span>
  );
}

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2.5 rounded-md', className)} aria-label="IndexRocket home">
      <LogoMark />
      <Wordmark />
    </Link>
  );
}
