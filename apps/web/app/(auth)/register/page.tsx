'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { Button } from '@/app/components/ui/button';
import { Alert, LoadingState } from '@/app/components/ui/feedback';
import { Field, fieldAria, Input } from '@/app/components/ui/form';
import { useToast } from '@/app/components/ui/toast';
import { apiFetch, describeError } from '@/app/lib/api';
import { safeNextPath } from '@/app/lib/session';

import { PasswordInput } from '../password-input';

const MIN_PASSWORD = 10;

interface Errors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

function RegisterForm() {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const requested = safeNextPath(params.get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): Errors => {
    const next: Errors = {};

    if (name.trim() === '') next.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) next.confirm = 'The passwords don’t match.';

    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);

    if (Object.keys(found).length > 0) {
      return;
    }

    setBusy(true);

    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
    } catch (caught) {
      setFormError(describeError(caught, { preferServerMessage: true }));
      setBusy(false);
      return;
    }

    // Registration does not create a session; signing in is a separate step.
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      toast.success('Welcome to IndexRocket', 'Your account is ready.');
      router.replace(requested ?? '/projects/new');
    } catch {
      toast.info('Account created', 'Please sign in to continue.');
      router.replace('/login');
    }
  };

  const loginHref = requested === null ? '/login' : `/login?next=${encodeURIComponent(requested)}`;

  return (
    <>
      <title>Create your account · IndexRocket</title>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">Start monitoring and submitting your URLs in minutes.</p>

      {formError ? (
        <Alert tone="danger" className="mt-6">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4" noValidate>
        <Field id="name" label="Name" error={errors.name ?? null}>
          <Input
            {...fieldAria('name', errors.name)}
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <Field id="email" label="Email" error={errors.email ?? null}>
          <Input
            {...fieldAria('email', errors.email)}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field id="password" label="Password" hint={`At least ${MIN_PASSWORD} characters.`} error={errors.password ?? null}>
          <PasswordInput
            {...fieldAria('password', errors.password, true)}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Field id="confirm" label="Confirm password" error={errors.confirm ?? null}>
          <PasswordInput
            {...fieldAria('confirm', errors.confirm)}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} iconRight={ArrowRight}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href={loginHref} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RegisterForm />
    </Suspense>
  );
}
