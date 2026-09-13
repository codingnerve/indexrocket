import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BadgeCheck,
  FolderKanban,
  KeyRound,
  Layers,
  Lock,
  Radar,
  ScanSearch,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { Logo } from './components/brand';
import { GoogleStatusBadge, IndexNowStatusBadge, UrlInspectionBadge } from './components/status';
import { LinkButton } from './components/ui/button';

const SIGNALS: ReadonlyArray<{ icon: LucideIcon; title: string; source: string; text: string; badges: ReactNode }> = [
  {
    icon: ScanSearch,
    title: 'Inspection',
    source: 'Measured by IndexRocket',
    text: 'We fetch each page and check its HTTP status, robots.txt rules, canonical tag and sitemap membership.',
    badges: (
      <>
        <UrlInspectionBadge status="inspected" />
        <UrlInspectionBadge status="processing" />
        <UrlInspectionBadge status="failed" />
      </>
    ),
  },
  {
    icon: BadgeCheck,
    title: 'Google Search Console',
    source: 'Reported by Google',
    text: 'Google’s URL Inspection API is the only source that can say whether a page is indexed — so it’s the only one we let say it.',
    badges: (
      <>
        <GoogleStatusBadge status="indexed" />
        <GoogleStatusBadge status="not_indexed" />
        <GoogleStatusBadge status={null} />
      </>
    ),
  },
  {
    icon: Radar,
    title: 'IndexNow',
    source: 'Notification status',
    text: 'Whether a participating search engine accepted the notification. Accepted means received — never “indexed”.',
    badges: (
      <>
        <IndexNowStatusBadge status="accepted" />
        <IndexNowStatusBadge status="pending" />
        <IndexNowStatusBadge status="not_submitted" />
      </>
    ),
  },
];

const FEATURES: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: FolderKanban,
    title: 'Projects per site',
    text: 'One workspace per domain. Every URL is validated against its project’s host before it’s stored.',
  },
  {
    icon: ScanSearch,
    title: 'URL inspection',
    text: 'Status codes, redirects, robots.txt, canonicals and sitemaps — checked from our servers, on demand.',
  },
  {
    icon: Send,
    title: 'Bulk submission',
    text: 'Select up to 200 URLs and follow the batch live: queued, processing, completed or failed, per URL.',
  },
  {
    icon: Radar,
    title: 'IndexNow notifications',
    text: 'Tell participating search engines about new and updated pages, with a 24-hour cooldown per URL.',
  },
  {
    icon: BadgeCheck,
    title: 'Search Console verdicts',
    text: 'Connect Google read-only and see coverage, indexing state, last crawl and Google’s chosen canonical.',
  },
  {
    icon: Layers,
    title: 'One clear picture',
    text: 'Dashboard, analytics and history built only from real results — no estimated numbers, no invented trends.',
  },
];

const STEPS = [
  { title: 'Create a project', text: 'Add the domain you want to monitor.' },
  { title: 'Add your URLs', text: 'One at a time or up to 500 per import.' },
  { title: 'Inspect and submit', text: 'Run checks and send IndexNow notifications in a batch.' },
  { title: 'Confirm with Google', text: 'Read Search Console’s verdict for the pages that matter.' },
];

const SECURITY: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Lock, title: 'HttpOnly sessions', text: 'Secure, SameSite cookies that scripts can’t read. No tokens in the browser.' },
  { icon: KeyRound, title: 'Encrypted Google tokens', text: 'OAuth tokens are encrypted at rest and never returned by the API.' },
  { icon: ShieldCheck, title: 'Ownership on every request', text: 'Projects, URLs and batches are always resolved through your account.' },
];

export default function HomePage() {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
            <a href="#features" className="hidden rounded-md px-3 py-2 text-sm text-muted hover:text-foreground md:inline-block">
              Features
            </a>
            <a href="#how-it-works" className="hidden rounded-md px-3 py-2 text-sm text-muted hover:text-foreground md:inline-block">
              How it works
            </a>
            <LinkButton href="/login" variant="ghost">
              Sign in
            </LinkButton>
            <LinkButton href="/register" variant="primary">
              Get started
            </LinkButton>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-[-280px] left-1/2 size-[720px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-20 text-center sm:px-6 sm:pt-28">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted shadow-xs">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              URL inspection · IndexNow · Google Search Console
            </p>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight text-foreground sm:text-6xl">
              Index smarter. <span className="text-primary">Grow faster.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Monitor, inspect and submit your URLs from one powerful indexing workspace — with every status coming
              from the source that actually knows it.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <LinkButton href="/register" variant="primary" size="lg" iconRight={ArrowRight}>
                Create your workspace
              </LinkButton>
              <LinkButton href="/login" size="lg">
                Sign in
              </LinkButton>
            </div>
          </div>

          <div className="relative mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:px-6 md:grid-cols-3">
            {SIGNALS.map(({ icon: Icon, title, source, text, badges }) => (
              <article key={title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                    <p className="text-xs text-muted">{source}</p>
                  </div>
                </div>
                <p className="mt-4 text-[13px] leading-6 text-muted">{text}</p>
                <div className="mt-5 flex flex-wrap gap-1.5">{badges}</div>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">Everything in one workspace</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Built for people who ship pages</h2>
            <p className="mt-3 text-muted">
              From a single landing page to thousands of URLs, IndexRocket keeps inspection, notification and Google’s
              verdict side by side — and never blurs the line between them.
            </p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-card p-6">
                <Icon className="size-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-6 text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-y border-border bg-sidebar">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <p className="text-sm font-medium text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">From new page to confirmed in four steps</h2>
            <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative rounded-xl border border-border bg-card p-6 shadow-xs">
                  <span className="font-mono text-xs font-medium text-primary">0{index + 1}</span>
                  <h3 className="mt-3 text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-primary">Security</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Your sites, your data, your account</h2>
            <p className="mt-3 text-muted">
              Access to Google is read-only, and every URL we fetch is checked against internal-network targets before a
              single request is made.
            </p>
          </div>
          <ul className="space-y-4">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                  <p className="mt-1 text-[13px] leading-6 text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="px-4 pb-24 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm sm:px-12">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Start indexing smarter today</h2>
            <p className="mx-auto mt-3 max-w-lg text-muted">
              Create a project, add your URLs and see exactly where each page stands.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton href="/register" variant="primary" size="lg" iconRight={ArrowRight}>
                Get started
              </LinkButton>
              <LinkButton href="/login" size="lg">
                Sign in
              </LinkButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted sm:px-6">
          <Logo />
          <p>© {year} IndexRocket. Index smarter. Grow faster.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <a href="/login" className="hover:text-foreground">
              Sign in
            </a>
            <a href="/register" className="hover:text-foreground">
              Create account
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
