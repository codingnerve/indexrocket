'use client';

import { FolderKanban, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { LinkButton } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/app/components/ui/feedback';
import { Select } from '@/app/components/ui/form';
import { PageHeader } from '@/app/components/ui/misc';
import { UrlTable } from '@/app/features/url-table';
import { describeError } from '@/app/lib/api';
import { loadProjects } from '@/app/lib/data';
import { useResource } from '@/app/lib/hooks';
import { URL_STATUS_FILTERS, type Project } from '@/app/lib/types';

function UrlsView() {
  const router = useRouter();
  const params = useSearchParams();
  const projects = useResource<Project[]>('projects', loadProjects);
  const list = projects.data ?? [];
  const current = list.find((project) => project.id === params.get('project')) ?? list[0];
  const requestedStatus = params.get('status') ?? 'all';
  const status = (URL_STATUS_FILTERS as readonly string[]).includes(requestedStatus) ? requestedStatus : 'all';

  let content;

  if (projects.loading) {
    content = (
      <Card>
        <TableSkeleton rows={8} columns={6} />
      </Card>
    );
  } else if (projects.error !== null && projects.data === undefined) {
    content = (
      <Card>
        <ErrorState message={describeError(projects.error)} onRetry={projects.reload} />
      </Card>
    );
  } else if (current === undefined) {
    content = (
      <Card>
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="URLs belong to a project. Create one to start adding URLs."
          action={
            <LinkButton href="/projects/new" variant="primary" icon={Plus}>
              Create your first project
            </LinkButton>
          }
        />
      </Card>
    );
  } else {
    content = <UrlTable key={`${current.id}:${status}`} project={current} initialStatus={status} />;
  }

  return (
    <>
      <PageHeader
        title="URLs"
        description="Every tracked page with its inspection, Google and IndexNow status."
        actions={
          list.length > 0 && current !== undefined ? (
            <Select
              aria-label="Project"
              className="w-60"
              value={current.id}
              onChange={(event) => router.replace(`/urls?project=${event.target.value}`, { scroll: false })}
            >
              {list.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.domain}
                </option>
              ))}
            </Select>
          ) : null
        }
      />
      {content}
    </>
  );
}

export default function UrlsPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <TableSkeleton rows={8} columns={6} />
        </Card>
      }
    >
      <UrlsView />
    </Suspense>
  );
}
