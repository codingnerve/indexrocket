'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  FolderKanban,
  Link2,
  Plus,
  Radar,
  RefreshCw,
  ScanSearch,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { isLiveBatch } from '@/app/components/status';
import { IconButton, LinkButton } from '@/app/components/ui/button';
import { Card, CardHeader, StatCard } from '@/app/components/ui/card';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/app/components/ui/feedback';
import { Select } from '@/app/components/ui/form';
import { PageHeader, SegmentedBar, type Segment } from '@/app/components/ui/misc';
import { BatchTable } from '@/app/features/batch-table';
import { describeError } from '@/app/lib/api';
import { cn } from '@/app/lib/cn';
import {
  loadGoogleAvailability,
  loadProjectsWithSummaries,
  loadRecentBatches,
  type BatchWithProject,
  type GoogleAvailability,
  type ProjectWithSummary,
} from '@/app/lib/data';
import { formatNumber, formatPercent, pluralize } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import { useSession } from '@/app/lib/session';
import { combineSummaries, googleSegments, indexNowSegments, inspectionSegments } from '@/app/lib/summary';
import type { ProjectSummary } from '@/app/lib/types';

interface DashboardData {
  projects: ProjectWithSummary[];
  batches: BatchWithProject[];
  google: GoogleAvailability;
}

async function loadDashboard(): Promise<DashboardData> {
  const projects = await loadProjectsWithSummaries();
  const [batches, google] = await Promise.all([
    loadRecentBatches(
      projects.map((entry) => entry.project),
      5,
    ),
    loadGoogleAvailability(),
  ]);

  return { projects, batches, google };
}

function OverviewRow({ title, caption, segments }: { title: string; caption: string; segments: Segment[] }) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted">{caption}</p>
      </div>
      <SegmentedBar segments={segments} label={title} />
    </div>
  );
}

interface Step {
  icon: LucideIcon;
  tone: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

/** "What should I do next?" — computed only from real state. */
function nextSteps(data: DashboardData, scoped: ProjectWithSummary[], summary: ProjectSummary): Step[] {
  const steps: Step[] = [];
  const firstProject = scoped[0]?.project;

  if (firstProject !== undefined && summary.totalUrls === 0) {
    steps.push({
      icon: Link2,
      tone: 'bg-primary-soft text-primary-soft-foreground',
      title: 'Add your first URLs',
      description: `Start tracking pages on ${firstProject.domain}.`,
      href: `/projects/${firstProject.id}?tab=urls`,
      cta: 'Add URLs',
    });
  }

  if (summary.inspection.failed > 0) {
    steps.push({
      icon: CircleAlert,
      tone: 'bg-danger-soft text-danger',
      title: `Review ${pluralize(summary.inspection.failed, 'failed inspection')}`,
      description: 'See what went wrong and inspect again.',
      href: scoped.length === 1 && firstProject ? `/urls?project=${firstProject.id}&status=failed` : '/urls?status=failed',
      cta: 'Review',
    });
  }

  if (data.google.state === 'available' && !data.google.connection.connected) {
    steps.push({
      icon: BadgeCheck,
      tone: 'bg-success-soft text-success',
      title: 'Connect Google Search Console',
      description: 'Read Google’s own verdict on whether your pages are indexed.',
      href: '/google',
      cta: 'Connect',
    });
  }

  const withoutKey = scoped.filter((entry) => !entry.project.hasIndexNowKey).length;

  if (withoutKey > 0) {
    steps.push({
      icon: Radar,
      tone: 'bg-info-soft text-info',
      title: `IndexNow isn’t set up for ${pluralize(withoutKey, 'project')}`,
      description: 'Without a key, IndexNow notifications are skipped.',
      href: '/indexnow',
      cta: 'Details',
    });
  }

  if (data.google.state === 'available' && data.google.connection.connected && summary.google.notInspected > 0) {
    steps.push({
      icon: ScanSearch,
      tone: 'bg-subtle text-muted',
      title: `${pluralize(summary.google.notInspected, 'URL')} not checked with Google`,
      description: 'Include a Google check when you submit, or check URLs one by one.',
      href: '/urls',
      cta: 'Open URLs',
    });
  }

  return steps.slice(0, 4);
}

export default function DashboardPage() {
  const { user } = useSession();
  const dashboard = useResource<DashboardData>('dashboard', loadDashboard, {
    poll: (data) => (data.batches.some((batch) => isLiveBatch(batch.status)) ? 8000 : null),
  });
  const [scope, setScope] = useState('all');
  const data = dashboard.data;

  const scoped = useMemo(
    () => (data === undefined ? [] : data.projects.filter((entry) => scope === 'all' || entry.project.id === scope)),
    [data, scope],
  );
  const summary = useMemo(() => combineSummaries(scoped.map((entry) => entry.summary)), [scoped]);
  const batches = useMemo(
    () => (data?.batches ?? []).filter((batch) => scope === 'all' || batch.projectId === scope).slice(0, 6),
    [data, scope],
  );

  const header = (
    <PageHeader
      title="Dashboard"
      description="Monitor your indexing activity and submission performance."
      actions={
        <>
          {data !== undefined && data.projects.length > 1 ? (
            <Select aria-label="Project" className="w-52" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">All projects</option>
              {data.projects.map((entry) => (
                <option key={entry.project.id} value={entry.project.id}>
                  {entry.project.name}
                </option>
              ))}
            </Select>
          ) : null}
          <IconButton icon={RefreshCw} label="Refresh" variant="secondary" size="md" onClick={dashboard.reload} loading={dashboard.refreshing} />
        </>
      }
    />
  );

  if (dashboard.error !== null && data === undefined) {
    return (
      <>
        {header}
        <Card>
          <ErrorState message={describeError(dashboard.error)} onRetry={dashboard.reload} />
        </Card>
      </>
    );
  }

  if (data !== undefined && data.projects.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={FolderKanban}
            title={`Welcome, ${user.name.split(' ')[0] ?? user.name}`}
            description="Create your first project to start monitoring URLs."
            action={
              <LinkButton href="/projects/new" variant="primary" icon={Plus}>
                Create your first project
              </LinkButton>
            }
          />
        </Card>
      </>
    );
  }

  const loading = data === undefined;
  const verdicts = summary.google.indexed + summary.google.notIndexed;
  const steps = data === undefined ? [] : nextSteps(data, scoped, summary);

  return (
    <>
      {header}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total URLs"
          icon={Link2}
          tone="primary"
          value={loading ? null : formatNumber(summary.totalUrls)}
          hint={loading ? undefined : `Across ${pluralize(scoped.length, 'project')}`}
        />
        <StatCard
          label="Indexed"
          icon={BadgeCheck}
          tone="success"
          value={loading ? null : formatNumber(summary.google.indexed)}
          hint={
            loading
              ? undefined
              : verdicts > 0
                ? `${formatPercent(summary.google.indexed, verdicts)} of URLs Google gave a verdict on`
                : 'As reported by Google Search Console'
          }
        />
        <StatCard
          label="Pending"
          icon={Clock}
          tone="info"
          value={loading ? null : formatNumber(summary.inspection.pending)}
          hint="Queued or being inspected"
        />
        <StatCard
          label="Failed"
          icon={CircleAlert}
          tone="danger"
          value={loading ? null : formatNumber(summary.inspection.failed)}
          hint="Inspections that failed"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Indexing overview" description="Current state of your URLs. Historical trends aren’t recorded yet." />
          <div className="space-y-7 p-5">
            {loading ? (
              Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))
            ) : summary.totalUrls === 0 ? (
              <EmptyState icon={Link2} title="Not enough data yet" description="Add URLs to see how they’re doing." className="py-8" />
            ) : (
              <>
                <OverviewRow title="Inspection" caption="IndexRocket’s own checks" segments={inspectionSegments(summary)} />
                <OverviewRow
                  title="Google Search Console"
                  caption="Google’s verdict — the only source for “indexed”"
                  segments={googleSegments(summary)}
                />
                <OverviewRow
                  title="IndexNow"
                  caption="Notifications accepted — not a statement about indexing"
                  segments={indexNowSegments(summary)}
                />
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Next steps" description="Suggestions based on your current data." />
          {loading ? (
            <div className="space-y-4 p-5">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : steps.length === 0 ? (
            <div className="flex items-start gap-3 p-5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success-soft text-success">
                <CircleCheck className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">You’re all caught up</p>
                <p className="mt-0.5 text-[13px] text-muted">Nothing needs your attention right now.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {steps.map((step) => (
                <li key={step.title}>
                  <Link href={step.href} className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-card-hover">
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', step.tone)}>
                      <step.icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">{step.title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{step.description}</p>
                    </div>
                    <ArrowRight
                      className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{step.cta}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Recent activity"
          description="Your latest submission batches."
          action={
            <LinkButton href="/submissions" size="sm" variant="ghost" iconRight={ArrowRight}>
              View all
            </LinkButton>
          }
        />
        {loading ? (
          <TableSkeleton rows={4} columns={6} />
        ) : batches.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No submissions yet"
            description="Your submission history will appear here."
            action={
              <LinkButton href="/urls" size="sm">
                Select URLs to submit
              </LinkButton>
            }
          />
        ) : (
          <BatchTable batches={batches} showProject={scope === 'all'} />
        )}
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Projects"
          description="Current URL counts per project."
          action={
            <LinkButton href="/projects" size="sm" variant="ghost" iconRight={ArrowRight}>
              All projects
            </LinkButton>
          }
        />
        {loading ? (
          <TableSkeleton rows={3} columns={4} />
        ) : (
          <ul className="divide-y divide-border">
            {scoped.map(({ project, summary: projectSummary }) => (
              <li key={project.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/projects/${project.id}`} className="text-sm font-medium text-foreground hover:text-primary">
                    {project.name}
                  </Link>
                  <p className="truncate text-[13px] text-muted">{project.domain}</p>
                </div>
                {projectSummary === null ? (
                  <span className="text-[13px] text-muted">Summary unavailable</span>
                ) : (
                  <>
                    <div className="hidden w-44 sm:block">
                      <SegmentedBar
                        size="sm"
                        showLegend={false}
                        segments={inspectionSegments(projectSummary)}
                        label={`Inspection status for ${project.name}`}
                      />
                    </div>
                    <div className="flex gap-6 text-[13px] tabular-nums">
                      <span>
                        <span className="font-medium text-foreground">{formatNumber(projectSummary.totalUrls)}</span>{' '}
                        <span className="text-muted">URLs</span>
                      </span>
                      <span>
                        <span className="font-medium text-foreground">{formatNumber(projectSummary.google.indexed)}</span>{' '}
                        <span className="text-muted">indexed</span>
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
