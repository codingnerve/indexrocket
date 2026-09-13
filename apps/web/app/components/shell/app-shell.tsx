'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ChartColumn,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Plug,
  Radar,
  ScanSearch,
  Send,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { formatNumber, humanize, initials } from '../../lib/format';
import { SessionProvider, useSession, useSessionState } from '../../lib/session';
import { ThemeSwitcher } from '../../lib/theme';
import type { SessionUser } from '../../lib/types';
import { Logo, LogoMark } from '../brand';
import { IconButton } from '../ui/button';
import { Drawer } from '../ui/dialog';
import { ErrorState, Skeleton } from '../ui/feedback';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAVIGATION: ReadonlyArray<{ title: string; items: NavItem[] }> = [
  {
    title: 'Main',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      { href: '/urls', label: 'URLs', icon: Link2 },
      { href: '/submissions', label: 'Submissions', icon: Send },
      { href: '/analytics', label: 'Analytics', icon: ChartColumn },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { href: '/google', label: 'Search Console', icon: ScanSearch },
      { href: '/indexnow', label: 'IndexNow', icon: Radar },
    ],
  },
  {
    title: 'Account',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Avatar({ user, className }: { user: SessionUser; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground',
        className,
      )}
    >
      {initials(user.name, user.email)}
    </span>
  );
}

function SidebarContent({ user, onNavigate, onClose }: { user: SessionUser; onNavigate?: () => void; onClose?: () => void }) {
  const pathname = usePathname();
  const { signOut } = useSession();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Logo href="/dashboard" />
        {onClose ? <IconButton icon={X} label="Close navigation" onClick={onClose} /> : null}
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-6 overflow-y-auto px-3 pt-3 pb-4">
        {NAVIGATION.map((group) => (
          <div key={group.title}>
            <p className="px-2 pb-1.5 text-2xs font-medium tracking-wider text-muted/80 uppercase">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-card text-foreground shadow-xs ring-1 ring-border'
                          : 'text-muted hover:bg-subtle hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('size-4', active ? 'text-primary' : '')} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t border-border p-3">
        <div className="rounded-md border border-border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium tracking-wider text-muted uppercase">Current plan</span>
            <span className="text-xs font-semibold text-primary">{humanize(user.plan)}</span>
          </div>
          <p className="mt-1 text-[13px] text-foreground">
            <span className="font-semibold tabular-nums">{formatNumber(user.credits)}</span>{' '}
            <span className="text-muted">{user.credits === 1 ? 'credit' : 'credits'} remaining</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 px-1">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <IconButton icon={LogOut} label="Sign out" onClick={() => void signOut()} />
        </div>
      </div>
    </div>
  );
}

function AccountMenu({ user }: { user: SessionUser }) {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (container.current !== null && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-subtle focus:bg-subtle focus:outline-none';

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-subtle md:pr-2"
      >
        <Avatar user={user} className="size-7" />
        <span className="hidden max-w-40 truncate text-[13px] font-medium text-foreground md:block">{user.name}</span>
        <ChevronDown className="hidden size-3.5 text-muted md:block" aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-40 mt-2 w-64 rounded-lg border border-border bg-card p-1.5 shadow-lg animate-slide-up"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-[13px] font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link href="/settings" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <Settings className="size-4 text-muted" aria-hidden="true" />
            Settings
          </Link>
          <Link href="/integrations" role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
            <Plug className="size-4 text-muted" aria-hidden="true" />
            Integrations
          </Link>
          <div className="flex items-center justify-between px-2.5 py-2 sm:hidden">
            <span className="text-[13px] text-foreground">Theme</span>
            <ThemeSwitcher />
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <LogOut className="size-4 text-muted" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ShellLayout({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-sidebar lg:block">
        <SidebarContent user={user} />
      </aside>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="Navigation">
        <SidebarContent user={user} onNavigate={() => setDrawerOpen(false)} onClose={() => setDrawerOpen(false)} />
      </Drawer>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-10">
        <IconButton icon={Menu} label="Open navigation" className="-ml-1.5 lg:hidden" onClick={() => setDrawerOpen(true)} />
        <Logo href="/dashboard" className="lg:hidden" />
        <div className="flex-1" />
        <ThemeSwitcher className="hidden sm:inline-flex" />
        <AccountMenu user={user} />
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1320px] px-4 pt-6 pb-16 focus:outline-none sm:px-6 lg:px-10 lg:pt-8">
        {children}
      </main>
    </div>
  );
}

function ShellSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-dvh lg:pl-64" role="status" aria-label={label}>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar p-4 lg:block">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-3/4" />
          ))}
        </div>
      </aside>
      <div className="h-14 border-b border-border" />
      <div className="mx-auto max-w-[1320px] space-y-6 px-4 pt-8 sm:px-6 lg:px-10">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

function ShellGate({ children }: { children: ReactNode }) {
  const { state, retry } = useSessionState();

  if (state.status === 'authenticated') {
    return <ShellLayout user={state.user}>{children}</ShellLayout>;
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <ErrorState title="We couldn’t reach IndexRocket" message={state.message} onRetry={retry} />
      </div>
    );
  }

  return <ShellSkeleton label={state.status === 'loading' ? 'Loading your workspace…' : 'Redirecting to sign in…'} />;
}

/** Authenticated application frame: session gate, sidebar, mobile drawer, top bar. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ShellGate>{children}</ShellGate>
    </SessionProvider>
  );
}
