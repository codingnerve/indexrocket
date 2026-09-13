'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/app/components/ui/button';
import { Alert, LoadingState } from '@/app/components/ui/feedback';
import { Field, fieldAria, Input } from '@/app/components/ui/form';
import { apiFetch, describeError, loadSession } from '@/app/lib/api';
import { safeNextPath } from '@/app/lib/session';

import { PasswordInput } from '../password-input';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = safeNextPath(params.get('next'));
  const destination = requested ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (for example a second tab): skip the form.
  useEffect(() => {
    let active = true;

    void loadSession().then((result) => {
      if (active && result.state === 'authenticated') {
        router.replace(destination);
      }
    });

    return () => {
      active = false;
    };
  }, [router, destination]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.replace(destination);
    } catch (caught) {
      setError(describeError(caught, { preferServerMessage: true }));
      setBusy(false);
    }
  };

  const registerHref = requested === null ? '/register' : `/register?next=${encodeURIComponent(requested)}`;

  return (
    <>
      <title>Sign in · IndexRocket</title>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted">Sign in to your IndexRocket workspace.</p>

      {error ? (
        <Alert tone="danger" className="mt-6">
          {error}
        </Alert>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
        <Field id="email" label="Email">
          <Input
            {...fieldAria('email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field id="password" label="Password">
          <PasswordInput
            {...fieldAria('password')}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} iconRight={ArrowRight}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New to IndexRocket?{' '}
        <Link href={registerHref} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-10 text-center text-xs leading-5 text-muted">
        Sessions use a secure, HttpOnly cookie. Your password is never stored in the browser.
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <LoginForm />
    </Suspense>
  );
}
