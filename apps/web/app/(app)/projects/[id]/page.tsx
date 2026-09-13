'use client';

import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Clock,
  ExternalLink,
  FolderX,
  LayoutGrid,
  Link2,
  Radar,
  ScanSearch,
  Send,
  Settings,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { isLiveBatch } from '@/app/components/status';
import { Badge } from '@/app/components/ui/badge';
import { Button, IconButton, LinkButton } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader, StatCard } from '@/app/components/ui/card';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/app/components/ui/feedback';
import { CopyButton, DetailList, PageHeader, SegmentedBar } from '@/app/components/ui/misc';
import { Pagination, panelId, tabId, Tabs } from '@/app/components/ui/navigation';
import { useToast } from '@/app/components/ui/toast';
import { BatchTable } from '@/app/features/batch-table';
import { isGoogleNotConfigured, useGoogleConnection } from '@/app/features/google';
import { DeleteProjectDialog, InspectUrlDialog, ProjectForm } from '@/app/features/project-dialogs';
import { UrlTable } from '@/app/features/url-table';
import { ApiError, describeError } from '@/app/lib/api';
import { formatDateTime, formatNumber } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import { googleSegments, indexNowSegments, inspectionSegments } from '@/app/lib/summary';
import type { ApiData, Batch, Paginated, Project, ProjectSummary } from '@/app/lib/types';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'urls', label: 'URLs', icon: Link2 },
  { id: 'submissions', label: 'Submissions', icon: Send },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function WorkspaceSkeleton() {
  return (
    <div role="status" aria-label="Loading project" className="space-y-6">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72" />
    </div>
  );
}

function OverviewPanel({ project, summary, onOpenTab }: { project: Project; summary: ProjectSummary | null; onOpenTab: (tab: string) => void }) {
  const batches = useResource<Paginated<Batch>>(`/api/projects/${project.id}/batches?limit=5`, undefined, {
    poll: (json) => (json.data.some((batch) => isLiveBatch(batch.status)) ? 5000 : null),
  });
  const google = useGoogleConnection();
  const connected = google.data?.data.connected === true;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Indexing overview" description="Current state of this project’s URLs." />
          <div className="space-y-7 p-5">
            {summary === null ? (
              <Skeleton className="h-40" />
            ) : summary.totalUrls === 0 ? (
              <EmptyState
                icon={Link2}
                title="No URLs yet"
                description="Add URLs to start inspecting and submitting pages."
                action={
                  <Button variant="primary" size="sm" onClick={() => onOpenTab('urls')}>
                    Add URLs
                  </Button>
                }
                className="py-8"
              />
            ) : (
              <>
                <div>
                  <h3 className="mb-2.5 text-[13px] font-semibold text-foreground">Inspection</h3>
                  <SegmentedBar segments={inspectionSegments(summary)} label="Inspection" />
                </div>
                <div>
                  <h3 className="mb-2.5 text-[13px] font-semibold text-foreground">Google Search Console</h3>
                  <SegmentedBar segments={googleSegments(summary)} label="Google Search Console" />
                </div>
                <div>
                  <h3 className="mb-2.5 text-[13px] font-semibold text-foreground">IndexNow</h3>
                  <SegmentedBar segments={indexNowSegments(summary)} label="IndexNow" />
                </div>
              </>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="IndexNow" icon={Radar} description="Notifications to participating search engines." />
            <CardBody className="space-y-3 text-[13px]">
              {project.hasIndexNowKey ? (
                <Badge tone="success" dot>
                  Key configured
                </Badge>
              ) : (
                <Badge tone="neutral">No key configured</Badge>
              )}
              <p className="leading-5 text-muted">
                {project.hasIndexNowKey
                  ? 'Eligible URLs can be notified, each at most once every 24 hours.'
                  : 'Without a key, IndexNow notifications for this project are skipped.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Google Search Console" icon={BadgeCheck} description="Google’s own indexing verdict." />
            <CardBody className="space-y-3 text-[13px]">
              {google.loading ? (
                <Skeleton className="h-5 w-32" />
              ) : isGoogleNotConfigured(google.error) ? (
                <Badge tone="neutral">Not available on this server</Badge>
              ) : connected ? (
                <Badge tone="success" dot>
                  Connected
                </Badge>
              ) : (
                <Badge tone="neutral">Not connected</Badge>
              )}
              {summary !== null ? (
                <p className="leading-5 text-muted">
                  {formatNumber(summary.google.indexed)} indexed · {formatNumber(summary.google.notIndexed)} not indexed ·{' '}
                  {formatNumber(summary.google.notInspected)} not checked
                </p>
              ) : null}
              {!connected && !google.loading && !isGoogleNotConfigured(google.error) ? (
                <LinkButton href="/google" size="sm" iconRight={ArrowRight}>
                  Connect Google
                </LinkButton>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Recent submissions"
          action={
            <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => onOpenTab('submissions')}>
              View all
            </Button>
          }
        />
        {batches.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : batches.error !== null && batches.data === undefined ? (
          <ErrorState message={describeError(batches.error)} onRetry={batches.reload} />
        ) : (batches.data?.data.length ?? 0) === 0 ? (
          <EmptyState icon={Send} title="No submissions yet" description="Your submission history will appear here." />
        ) : (
          <BatchTable batches={batches.data?.data ?? []} />
        )}
      </Card>
    </div>
  );
}

function SubmissionsPanel({ projectId, onOpenTab }: { projectId: string; onOpenTab: (tab: string) => void }) {
  const [page, setPage] = useState(1);
  const batches = useResource<Paginated<Batch>>(`/api/projects/${projectId}/batches?page=${page}&limit=20`, undefined, {
    poll: (json) => (json.data.some((batch) => isLiveBatch(batch.status)) ? 5000 : null),
  });
  const rows = batches.data?.data ?? [];
  const pagination = batches.data?.pagination;

  return (
    <Card className="overflow-hidden">
      {batches.loading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : batches.error !== null && batches.data === undefined ? (
        <ErrorState message={describeError(batches.error)} onRetry={batches.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No submissions yet"
          description="Your submission history will appear here. Select URLs in the URLs tab to start a batch."
          action={
            <Button variant="primary" size="sm" onClick={() => onOpenTab('urls')}>
              Go to URLs
            </Button>
          }
        />
      ) : (
        <>
          <BatchTable batches={rows} />
          {pagination ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              noun="batches"
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

function SettingsPanel({ project, onSaved, onDelete }: { project: Project; onSaved: () => void; onDelete: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="General" description="Name and domain of this project." />
        <CardBody>
          <ProjectForm key={project.updatedAt} project={project} onSaved={onSaved} />
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="IndexNow" icon={Radar} />
          <CardBody className="space-y-3">
            <DetailList
              items={[
                {
                  label: 'Key',
                  value: project.hasIndexNowKey ? (
                    <Badge tone="success" dot>
                      Configured
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Not configured</Badge>
                  ),
                },
                {
                  label: 'Key location',
                  value: project.indexNowKeyLocation ? (
                    <a
                      href={project.indexNowKeyLocation}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                    >
                      {project.indexNowKeyLocation}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  ) : null,
                },
              ]}
            />
            <p className="text-xs leading-5 text-muted">
              The key itself is never shown. IndexNow keys can’t be managed from the dashboard yet.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              items={[
                { label: 'Created', value: formatDateTime(project.createdAt) },
                { label: 'Last updated', value: formatDateTime(project.updatedAt) },
                {
                  label: 'Project ID',
                  value: (
                    <span className="flex items-center gap-1 font-mono text-xs">
                      {project.id}
                      <CopyButton value={project.id} label="Copy project ID" />
                    </span>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card className="border-danger/30">
          <CardHeader title="Danger zone" description="Deleting a project removes it and every URL it tracks." />
          <CardBody>
            <Button variant="danger" icon={Trash2} onClick={onDelete}>
              Delete project
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const requestedTab = params.get('tab') ?? 'overview';
  const tab = TABS.some((entry) => entry.id === requestedTab) ? requestedTab : 'overview';

  const project = useResource<ApiData<Project>>(`/api/projects/${id}`);
  const summary = useResource<ApiData<ProjectSummary>>(`/api/projects/${id}/summary`);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const openTab = (next: string) => {
    router.replace(next === 'overview' ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  };

  if (project.loading) {
    return <WorkspaceSkeleton />;
  }

  if (project.data === undefined) {
    const notFound = project.error instanceof ApiError && (project.error.status === 404 || project.error.status === 400);

    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={FolderX}
            title="Project not found"
            description="It may have been deleted, or it belongs to another account."
            action={<LinkButton href="/projects">Back to projects</LinkButton>}
          />
        ) : (
          <ErrorState message={describeError(project.error)} onRetry={project.reload} />
        )}
      </Card>
    );
  }

  const current = project.data.data;
  const counts = summary.data?.data ?? null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: current.name }]}
        title={current.name}
        meta={
          <>
            <a
              href={`https://${current.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
            >
              {current.domain}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            {current.hasIndexNowKey ? (
              <Badge tone="success" dot>
                IndexNow key configured
              </Badge>
            ) : (
              <Badge tone="neutral">No IndexNow key</Badge>
            )}
          </>
        }
        actions={
          <>
            <Button icon={ScanSearch} onClick={() => setInspectOpen(true)}>
              Inspect
            </Button>
            <Button
              variant="primary"
              icon={Send}
              onClick={() => {
                openTab('urls');
                toast.info('Choose the URLs to submit', 'Tick them in the table, then select “Submit selected”.');
              }}
            >
              Submit URLs
            </Button>
            <IconButton icon={Settings} label="Project settings" variant="secondary" size="md" onClick={() => openTab('settings')} />
          </>
        }
      />

      <section aria-label="Project numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total URLs" icon={Link2} tone="primary" value={counts ? formatNumber(counts.totalUrls) : null} />
        <StatCard
          label="Indexed"
          icon={BadgeCheck}
          tone="success"
          value={counts ? formatNumber(counts.google.indexed) : null}
          hint="Google’s verdict"
        />
        <StatCard label="Inspected" icon={ScanSearch} tone="info" value={counts ? formatNumber(counts.inspection.inspected) : null} />
        <StatCard label="Pending" icon={Clock} value={counts ? formatNumber(counts.inspection.pending) : null} hint="Queued or inspecting" />
        <StatCard label="Failed" icon={CircleAlert} tone="danger" value={counts ? formatNumber(counts.inspection.failed) : null} />
      </section>

      <Tabs
        className="mt-8"
        label="Project sections"
        tabs={TABS.map((entry) => (entry.id === 'urls' && counts ? { ...entry, count: counts.totalUrls } : entry))}
        value={tab}
        onChange={openTab}
      />

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="pt-6">
        {tab === 'overview' ? <OverviewPanel project={current} summary={counts} onOpenTab={openTab} /> : null}
        {tab === 'urls' ? <UrlTable project={current} onChanged={summary.reload} /> : null}
        {tab === 'submissions' ? <SubmissionsPanel projectId={current.id} onOpenTab={openTab} /> : null}
        {tab === 'settings' ? (
          <SettingsPanel project={current} onSaved={project.reload} onDelete={() => setDeleteOpen(true)} />
        ) : null}
      </div>

      <InspectUrlDialog open={inspectOpen} onClose={() => setInspectOpen(false)} project={current} />
      <DeleteProjectDialog
        project={deleteOpen ? current : null}
        urlCount={counts?.totalUrls ?? null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => router.replace('/projects')}
      />
      <p className="sr-only">
        <Link href="/projects">All projects</Link>
      </p>
    </>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <ProjectWorkspace />
    </Suspense>
  );
}
