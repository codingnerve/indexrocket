'use client';

import { CircleAlert, CircleCheck, Layers, LoaderCircle, RefreshCw, Send } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { isLiveBatch } from '@/app/components/status';
import { IconButton, LinkButton } from '@/app/components/ui/button';
import { Card, CardHeader, StatCard } from '@/app/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/app/components/ui/feedback';
import { Select } from '@/app/components/ui/form';
import { PageHeader } from '@/app/components/ui/misc';
import { BatchTable } from '@/app/features/batch-table';
import { describeError } from '@/app/lib/api';
import { loadProjects, loadRecentBatches, type BatchWithProject } from '@/app/lib/data';
import { formatNumber, pluralize } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import type { Project } from '@/app/lib/types';

function SubmissionsView() {
  const router = useRouter();
  const params = useSearchParams();
  const projects = useResource<Project[]>('projects', loadProjects);
  const list = projects.data ?? [];
  const requested = params.get('project') ?? 'all';
  const filter = requested === 'all' || list.some((project) => project.id === requested) ? requested : 'all';
  const selected = filter === 'all' ? list : list.filter((project) => project.id === filter);

  const history = useResource<BatchWithProject[]>(
    projects.data === undefined ? null : `submissions:${filter}:${list.map((project) => project.id).join(',')}`,
    () => loadRecentBatches(selected, filter === 'all' ? 20 : 50),
    { poll: (rows) => (rows.some((row) => isLiveBatch(row.status)) ? 5000 : null) },
  );

  const rows = history.data ?? [];
  const live = rows.filter((row) => isLiveBatch(row.status)).length;
  const loading = projects.loading || history.loading;

  let content;

  if (loading) {
    content = <TableSkeleton rows={6} columns={7} />;
  } else if ((projects.error ?? history.error) !== null && rows.length === 0) {
    content = (
      <ErrorState
        message={describeError(projects.error ?? history.error)}
        onRetry={() => {
          projects.reload();
          history.reload();
        }}
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyState
        icon={Send}
        title="No submissions yet"
        description="Your submission history will appear here. Select URLs in a project and choose “Submit selected”."
        action={
          <LinkButton href="/urls" variant="primary" size="sm">
            Select URLs to submit
          </LinkButton>
        }
      />
    );
  } else {
    content = <BatchTable batches={rows} showProject={filter === 'all'} />;
  }

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Bulk submission batches: inspection, IndexNow notification and optional Google checks, tracked per URL."
        actions={
          <>
            {list.length > 1 ? (
              <Select
                aria-label="Project"
                className="w-52"
                value={filter}
                onChange={(event) =>
                  router.replace(event.target.value === 'all' ? '/submissions' : `/submissions?project=${event.target.value}`, {
                    scroll: false,
                  })
                }
              >
                <option value="all">All projects</option>
                {list.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <IconButton icon={RefreshCw} label="Refresh" variant="secondary" size="md" onClick={history.reload} loading={history.refreshing} />
          </>
        }
      />

      <section aria-label="Submission numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Running now" icon={LoaderCircle} tone="info" value={loading ? null : formatNumber(live)} />
        <StatCard
          label="URLs submitted"
          icon={Layers}
          tone="primary"
          value={loading ? null : formatNumber(rows.reduce((sum, row) => sum + row.total, 0))}
          hint={loading ? undefined : `Across ${pluralize(rows.length, 'batch', 'batches')} shown`}
        />
        <StatCard
          label="Completed"
          icon={CircleCheck}
          tone="success"
          value={loading ? null : formatNumber(rows.reduce((sum, row) => sum + row.completed, 0))}
        />
        <StatCard
          label="Failed"
          icon={CircleAlert}
          tone="danger"
          value={loading ? null : formatNumber(rows.reduce((sum, row) => sum + row.failed, 0))}
        />
      </section>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Submission history"
          description={filter === 'all' ? 'The most recent batches across your projects.' : 'The most recent batches for this project.'}
        />
        {content}
      </Card>
    </>
  );
}

export default function SubmissionsPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <TableSkeleton rows={6} columns={7} />
        </Card>
      }
    >
      <SubmissionsView />
    </Suspense>
  );
}
