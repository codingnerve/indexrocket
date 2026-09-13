import { BadgeCheck, Radar, ScanSearch } from 'lucide-react';
import type { ReactNode } from 'react';

import { Logo } from '@/app/components/brand';

const POINTS = [
  {
    icon: ScanSearch,
    title: 'Inspect every page',
    text: 'HTTP status, robots.txt, canonical and sitemap checks on the pages you care about.',
  },
  {
    icon: Radar,
    title: 'Notify search engines',
    text: 'Send IndexNow notifications one by one or in bulk, with a 24-hour cooldown per URL.',
  },
  {
    icon: BadgeCheck,
    title: 'Hear it from Google',
    text: 'Read Google Search Console’s own verdict — the only source that can say a page is indexed.',
  },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-48 -left-40 size-[520px] rounded-full bg-primary/10 blur-3xl"
        />
        <Logo className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-foreground">
            Index smarter.
            <br />
            Grow faster.
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-muted">
            Monitor, inspect and submit your URLs from one powerful indexing workspace.
          </p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary shadow-xs">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative max-w-md text-xs leading-5 text-muted">
          Your own inspection, Google’s verdict and IndexNow notifications are kept separate — never merged, never
          guessed.
        </p>
      </aside>

      <main className="flex flex-col px-4 py-6 sm:px-8">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-slide-up">{children}</div>
        </div>
      </main>
    </div>
  );
}
