import type { Metadata } from 'next';

import { Logo } from './components/brand';
import { LinkButton } from './components/ui/button';

export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <p className="mt-12 font-mono text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">We couldn’t find that page</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The page may have moved, or the link might be incorrect.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <LinkButton href="/dashboard" variant="primary">
          Go to dashboard
        </LinkButton>
        <LinkButton href="/">IndexRocket home</LinkButton>
      </div>
    </main>
  );
}
