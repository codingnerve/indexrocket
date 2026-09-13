'use client';

import { ArrowRight, CircleAlert, ExternalLink, FolderKanban, KeyRound, Plus, Radar, Send } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/app/components/ui/badge';
import { LinkButton } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader, StatCard } from '@/app/components/ui/card';
import { Alert, EmptyState, ErrorState, TableSkeleton } from '@/app/components/ui/feedback';
import { PageHeader } from '@/app/components/ui/misc';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/app/components/ui/table';
import { describeError } from '@/app/lib/api';
import { loadProjectsWithSummaries, type ProjectWithSummary } from '@/app/lib/data';
import { formatNumber } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import { combineSummaries } from '@/app/lib/summary';

const STEPS = [
  'A key file is published on the site at its key location, proving you control the host.',
  'You notify a URL from its row, its detail page, or a submission batch.',
  'IndexRocket checks eligibility — a URL is notified at most once every 24 hours.',
  'The endpoint accepts or rejects the notification. Accepted means received, not indexed.',
];

export default function IndexNowPage() {
  const projects = useResource<ProjectWithSummary[]>('projects-with-summaries', loadProjectsWithSummaries);
  const list = projects.data ?? [];
  const totals = combineSummaries(list.map((entry) => entry.summary));
  const configured = list.filter((entry) => entry.project.hasIndexNowKey).length;
  const loading = projects.loading;

  return (
    <>
      <PageHeader title="IndexNow" description="Notify participating search engines when your pages are added or updated." />

      <Alert tone="info" className="mb-6" title="What an IndexNow notification means">
        IndexNow tells participating search engines, such as Microsoft Bing and Yandex, that a URL changed. An accepted
        notification means it was received — not that the page is indexed. Google doesn’t take part in IndexNow; use
        Search Console for Google.
      </Alert>

      <section aria-label="IndexNow numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Projects with a key"
          icon={KeyRound}
          tone="primary"
          value={loading ? null : `${formatNumber(configured)} / ${formatNumber(list.length)}`}
        />
        <StatCard label="Notified" icon={Radar} tone="info" value={loading ? null : formatNumber(totals.indexNow.accepted)} hint="Accepted notifications" />
        <StatCard label="Sending" icon={Send} value={loading ? null : formatNumber(totals.indexNow.pending)} />
        <StatCard label="Failed" icon={CircleAlert} tone="danger" value={loading ? null : formatNumber(totals.indexNow.failed)} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Projects" description="Key status and notification results per project." />
          {loading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : projects.error !== null && projects.data === undefined ? (
            <ErrorState message={describeError(projects.error)} onRetry={projects.reload} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create your first project to start monitoring URLs."
              action={
                <LinkButton href="/projects/new" variant="primary" size="sm" icon={Plus}>
                  Create a project
                </LinkButton>
              }
            />
          ) : (
            <TableContainer>
              <Table className="min-w-[760px]">
                <THead>
                  <Th>Project</Th>
                  <Th>Key</Th>
                  <Th className="text-right">Notified</Th>
                  <Th className="text-right">Sending</Th>
                  <Th className="text-right">Failed</Th>
                  <Th className="text-right">Not notified</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </THead>
                <TBody>
                  {list.map(({ project, summary }) => (
                    <Tr key={project.id}>
                      <Td>
                        <Link href={`/projects/${project.id}`} className="font-medium text-foreground hover:text-primary">
                          {project.name}
                        </Link>
                        <p className="text-xs text-muted">{project.domain}</p>
                      </Td>
                      <Td>
                        {project.hasIndexNowKey ? (
                          <div className="space-y-1">
                            <Badge tone="success" dot>
                              Configured
                            </Badge>
                            {project.indexNowKeyLocation ? (
                              <a
                                href={project.indexNowKeyLocation}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
                              >
                                Key file
                                <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <Badge tone="neutral">Not configured</Badge>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{summary ? formatNumber(summary.indexNow.accepted) : '—'}</Td>
                      <Td className="text-right tabular-nums">{summary ? formatNumber(summary.indexNow.pending) : '—'}</Td>
                      <Td className="text-right tabular-nums">{summary ? formatNumber(summary.indexNow.failed) : '—'}</Td>
                      <Td className="text-right tabular-nums">{summary ? formatNumber(summary.indexNow.notSubmitted) : '—'}</Td>
                      <Td className="text-right">
                        <LinkButton href={`/urls?project=${project.id}`} size="sm" variant="ghost" iconRight={ArrowRight}>
                          URLs
                        </LinkButton>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="How it works" icon={Radar} />
            <ol className="space-y-4 p-5">
              {STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-[13px] leading-5 text-muted">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary-soft-foreground">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardBody className="text-[13px] leading-5 text-muted">
              Keys are never shown in the dashboard, and they can’t be managed from here yet. A project without a key still
              gets inspected — its IndexNow step is skipped.
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
