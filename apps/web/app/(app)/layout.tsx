import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/app/components/shell/app-shell';

/** Authenticated application pages are never meant for search engines. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
