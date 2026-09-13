'use client';

import { BadgeCheck, FolderPlus, Link2, Radar, ScanSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, LinkButton } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader } from '@/app/components/ui/card';
import { Alert } from '@/app/components/ui/feedback';
import { Field, fieldAria, Input } from '@/app/components/ui/form';
import { PageHeader } from '@/app/components/ui/misc';
import { apiFetch, describeError } from '@/app/lib/api';
import { useAction } from '@/app/lib/hooks';
import type { ApiData, Project } from '@/app/lib/types';

interface Errors {
  name?: string;
  domain?: string;
  form?: string;
}

const NEXT = [
  { icon: Link2, title: 'Add URLs', text: 'One by one or up to 500 per import.' },
  { icon: ScanSearch, title: 'Inspect', text: 'HTTP status, robots.txt, canonical and sitemap.' },
  { icon: Radar, title: 'Notify IndexNow', text: 'Once an IndexNow key is configured for the project.' },
  { icon: BadgeCheck, title: 'Check with Google', text: 'After connecting Search Console.' },
];

export default function NewProjectPage() {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const found: Errors = {};

    if (name.trim() === '') found.name = 'Give the project a name.';
    if (domain.trim() === '') found.domain = 'Enter the site’s domain.';
    else if (/\s/.test(domain.trim())) found.domain = 'A domain can’t contain spaces.';

    setErrors(found);

    if (Object.keys(found).length > 0) return;

    const json = await run(
      'create-project',
      () =>
        apiFetch<ApiData<Project>>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), domain: domain.trim() }),
        }),
      {
        success: 'Project created',
        successDescription: (response) => `Now tracking ${response.data.domain}.`,
        errorTitle: 'Couldn’t create the project',
        onError: (caught) => {
          const message = describeError(caught);
          setErrors(/domain/i.test(message) ? { domain: message } : { form: message });
        },
      },
    );

    if (json !== undefined) {
      router.push(`/projects/${json.data.id}`);
    }
  };

  return (
    <>
      <PageHeader
        title="New project"
        description="A project is one website. URLs you add must belong to its domain."
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: 'New project' }]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Project details" icon={FolderPlus} />
          <CardBody>
            <form onSubmit={(event) => void submit(event)} className="max-w-lg space-y-5" noValidate>
              {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
              <Field id="name" label="Project name" hint="Shown in your dashboard, e.g. “Marketing site”." error={errors.name ?? null}>
                <Input
                  {...fieldAria('name', errors.name, true)}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  placeholder="My website"
                  required
                  autoFocus
                />
              </Field>
              <Field
                id="domain"
                label="Domain"
                hint="A hostname like example.com. A pasted URL is reduced to its host, and www. is treated as the same site."
                error={errors.domain ?? null}
              >
                <Input
                  {...fieldAria('domain', errors.domain, true)}
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="example.com"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit" variant="primary" loading={isPending('create-project')}>
                  Create project
                </Button>
                <LinkButton href="/projects">Cancel</LinkButton>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="What happens next" />
          <ol className="space-y-4 p-5">
            {NEXT.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-muted">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-foreground">{title}</p>
                  <p className="text-xs leading-5 text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
