'use client';

import { LayoutDashboard } from 'lucide-react';

import { LinkButton } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { ErrorState } from '@/app/components/ui/feedback';

/** Render-error boundary for app pages. The raw error is never shown to the user. */
export default function AppError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const again = retry ?? reset;

  return (
    <Card className="mt-6">
      <ErrorState
        title="Something went wrong"
        message="This page hit an unexpected problem. Try again, or head back to the dashboard."
        {...(again ? { onRetry: again } : {})}
      />
      <div className="flex flex-col items-center gap-3 pb-10">
        <LinkButton href="/dashboard" size="sm" icon={LayoutDashboard}>
          Back to dashboard
        </LinkButton>
        {error.digest ? <p className="text-xs text-muted">Reference: {error.digest}</p> : null}
      </div>
    </Card>
  );
}
