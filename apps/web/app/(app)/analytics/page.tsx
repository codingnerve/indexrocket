'use client';

import type { LucideIcon } from 'lucide-react';
import { BadgeCheck, ChartColumn, CircleAlert, Clock, Radar, ScanSearch, Send, Telescope } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { Tone } from '@/app/components/ui/badge';
import { LinkButton } from '@/app/components/ui/button';
import { Card, CardHeader, StatCard } from '@/app/components/ui/card';
import { Alert, EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/app/components/ui/feedback';
import { Select } from '@/app/components/ui/form';
import { PageHeader, ProgressBar, SegmentedBar } from '@/app/components/ui/misc';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/app/components/ui/table';
import { describeError } from '@/app/lib/api';
import { loadProjectsWithSummaries, loadRecentBatches, type BatchWithProject, type ProjectWithSummary } from '@/app/lib/data';
import { formatNumber, formatPercent, percentOf, pluralize } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import { combineSummaries, googleChecked, googleSegments, indexNowSegments, inspectionSegments } from '@/app/lib/summary';

interface AnalyticsData {
  projects: ProjectWithSummary[];
  batches: BatchWithProject[];
}

async function loadAnalytics(): Promise<AnalyticsData> {
  const projects = await loadProjectsWithSummaries();
  const batches = await loadRecentBatches(
    projects.map((entry) => entry.project),
    20,
  );

  return { projects, batches };
}

/** A rate computed from real counts; "Not enough data yet" when the denominator is zero. */
function RateCard({
  label,
  icon,
  tone,
  part,
  whole,
  detail,
}: {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  part: number;
  whole: number;
  detail: string;
}) {
  const value = percentOf(part, whole);

  return (
    <StatCard
      label={label}
      icon={icon}
      tone={tone}
      value={value === null ? <span className="text-base font-medium text-muted">Not enough data yet</span> : `${value.toFixed(0)}%`}
      hint={value === null ? detail : `${formatNumber(part)} of ${formatNumber(whole)} ${detail}`}
      footer={value === null ? undefined : <ProgressBar value={part} max={whole} label={label} tone={tone} />}
    />
  );
}

export default function AnalyticsPage() {
  const analytics = useResource<AnalyticsData>('analytics', loadAnalytics);
  const [scope, setScope] = useState('all');
  const data = analytics.data;

  const scoped = useMemo(
    () => (data === undefined ? [] : data.projects.filter((entry) => scope === 'all' || entry.project.id === scope)),
    [data, scope],
  );
  const summary = useMemo(() => combineSummaries(scoped.map((entry) => entry.summary)), [scoped]);
  const batches = useMemo(
    () => (data?.batches ?? []).filter((batch) => scope === 'all' || batch.projectId === scope),
    [data, scope],
  );

  const itemsCompleted = batches.reduce((sum, batch) => sum + batch.completed, 0);
  const itemsFailed = batches.reduce((sum, batch) => sum + batch.failed, 0);
  const checked = googleChecked(summary);
  const verdicts = summary.google.indexed + summary.google.notIndexed;

  const header = (
    <PageHeader
      title="Analytics"
      description="Current indexing health, calculated from your real inspection, Google and IndexNow results."
      actions={
        data !== undefined && data.projects.length > 1 ? (
          <Select aria-label="Project" className="w-52" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="all">All projects</option>
            {data.projects.map((entry) => (
              <option key={entry.project.id} value={entry.project.id}>
                {entry.project.name}
              </option>
            ))}
          </Select>
        ) : null
      }
    />
  );

  if (analytics.loading) {
    return (
      <>
        {header}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      </>
    );
  }

  if (data === undefined) {
    return (
      <>
        {header}
        <Card>
          <ErrorState message={describeError(analytics.error)} onRetry={analytics.reload} />
        </Card>
      </>
    );
  }

  if (data.projects.length === 0 || summary.totalUrls === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Telescope}
            title="Not enough data yet"
            description="Analytics appear once your projects have URLs with inspection, Google or IndexNow results."
            action={
              <LinkButton href={data.projects.length === 0 ? '/projects/new' : '/urls'} variant="primary" size="sm">
                {data.projects.length === 0 ? 'Create a project' : 'Add URLs'}
              </LinkButton>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}

      <Alert tone="info" className="mb-6">
        These figures reflect the current state of your URLs and your most recent submissions. IndexRocket doesn’t store
        history yet, so trends over time aren’t available.
      </Alert>

      <section aria-label="Rates" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RateCard
          label="Google index rate"
          icon={BadgeCheck}
          tone="success"
          part={summary.google.indexed}
          whole={verdicts}
          detail="URLs Google gave a verdict on"
        />
        <RateCard
          label="Checked with Google"
          icon={ChartColumn}
          tone="primary"
          part={checked}
          whole={summary.totalUrls}
          detail="tracked URLs"
        />
        <RateCard
          label="Inspection success"
          icon={ScanSearch}
          tone="info"
          part={summary.inspection.inspected}
          whole={summary.inspection.inspected + summary.inspection.failed}
          detail="finished inspections"
        />
        <RateCard
          label="IndexNow acceptance"
          icon={Radar}
          tone="info"
          part={summary.indexNow.accepted}
          whole={summary.indexNow.accepted + summary.indexNow.failed}
          detail="notifications sent"
        />
      </section>

      <section aria-label="Counts" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RateCard
          label="Submission success"
          icon={Send}
          tone="success"
          part={itemsCompleted}
          whole={itemsCompleted + itemsFailed}
          detail={`finished URLs in ${pluralize(batches.length, 'recent batch', 'recent batches')}`}
        />
        <StatCard label="Failed URLs" icon={CircleAlert} tone="danger" value={formatNumber(summary.inspection.failed)} hint="Inspection failed" />
        <StatCard label="Pending URLs" icon={Clock} value={formatNumber(summary.inspection.pending)} hint="Queued or being inspected" />
        <StatCard
          label="Not checked with Google"
          icon={BadgeCheck}
          value={formatNumber(summary.google.notInspected)}
          hint="No Google verdict stored yet"
        />
      </section>

      <Card className="mt-6">
        <CardHeader title="Current distribution" description={`${pluralize(summary.totalUrls, 'tracked URL')}.`} />
        <div className="grid gap-8 p-5 lg:grid-cols-3">
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-foreground">Inspection</h3>
            <SegmentedBar segments={inspectionSegments(summary)} label="Inspection" />
          </div>
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-foreground">Google Search Console</h3>
            <SegmentedBar segments={googleSegments(summary)} label="Google Search Console" />
          </div>
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-foreground">IndexNow</h3>
            <SegmentedBar segments={indexNowSegments(summary)} label="IndexNow" />
          </div>
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader title="By project" />
        {scoped.length === 0 ? (
          <TableSkeleton rows={2} columns={5} />
        ) : (
          <TableContainer>
            <Table className="min-w-[720px]">
              <THead>
                <Th>Project</Th>
                <Th className="text-right">URLs</Th>
                <Th className="text-right">Inspected</Th>
                <Th className="text-right">Checked with Google</Th>
                <Th className="text-right">Indexed (Google)</Th>
                <Th className="text-right">Notified</Th>
                <Th className="text-right">Failed</Th>
              </THead>
              <TBody>
                {scoped.map(({ project, summary: row }) => (
                  <Tr key={project.id}>
                    <Td>
                      <Link href={`/projects/${project.id}`} className="font-medium text-foreground hover:text-primary">
                        {project.name}
                      </Link>
                      <p className="text-xs text-muted">{project.domain}</p>
                    </Td>
                    {row === null ? (
                      <Td colSpan={6} className="text-right text-muted">
                        Summary unavailable
                      </Td>
                    ) : (
                      <>
                        <Td className="text-right tabular-nums">{formatNumber(row.totalUrls)}</Td>
                        <Td className="text-right tabular-nums">
                          {formatNumber(row.inspection.inspected)}{' '}
                          <span className="text-xs text-muted">{formatPercent(row.inspection.inspected, row.totalUrls)}</span>
                        </Td>
                        <Td className="text-right tabular-nums">
                          {formatNumber(googleChecked(row))}{' '}
                          <span className="text-xs text-muted">{formatPercent(googleChecked(row), row.totalUrls)}</span>
                        </Td>
                        <Td className="text-right tabular-nums">{formatNumber(row.google.indexed)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(row.indexNow.accepted)}</Td>
                        <Td className={row.inspection.failed > 0 ? 'text-right text-danger tabular-nums' : 'text-right tabular-nums'}>
                          {formatNumber(row.inspection.failed)}
                        </Td>
                      </>
                    )}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </>
  );
}
