'use client';

import './globals.css';

/** Last-resort boundary for errors in the root layout. Renders its own document. */
export default function GlobalError({
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
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 font-sans text-foreground">
        <title>Something went wrong · IndexRocket</title>
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">IndexRocket hit an unexpected problem. Please try again.</p>
          {error.digest ? <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p> : null}
          {again ? (
            <button
              type="button"
              onClick={() => again()}
              className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
          ) : null}
        </div>
      </body>
    </html>
  );
}
