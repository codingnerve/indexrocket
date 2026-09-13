'use client';

import { ArrowRight, FolderKanban, Globe, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/app/components/ui/badge';
import { IconButton, LinkButton } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/app/components/ui/feedback';
import { PageHeader, SearchInput } from '@/app/components/ui/misc';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/app/components/ui/table';
import { DeleteProjectDialog, EditProjectDialog } from '@/app/features/project-dialogs';
import { describeError } from '@/app/lib/api';
import { loadProjectsWithSummaries, type ProjectWithSummary } from '@/app/lib/data';
import { formatDateTime, formatNumber, formatRelative, pluralize } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import type { Project, ProjectSummary } from '@/app/lib/types';

function ProjectStatus({ summary }: { summary: ProjectSummary | null }) {
  if (summary === null) return <Badge tone="neutral">Unavailable</Badge>;
  if (summary.totalUrls === 0) return <Badge tone="neutral">No URLs</Badge>;
  if (summary.inspection.failed > 0) return <Badge tone="danger">{formatNumber(summary.inspection.failed)} failed</Badge>;
  if (summary.inspection.pending > 0)
    return (
      <Badge tone="info" dot>
        {formatNumber(summary.inspection.pending)} pending
      </Badge>
    );

  return <Badge tone="success">All inspected</Badge>;
}

function KeyBadge({ project }: { project: Project }) {
  return project.hasIndexNowKey ? (
    <Badge tone="success" dot>
      Key configured
    </Badge>
  ) : (
    <Badge tone="neutral">No key</Badge>
  );
}

export default function ProjectsPage() {
  const projects = useResource<ProjectWithSummary[]>('projects-with-summaries', loadProjectsWithSummaries);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<ProjectWithSummary | null>(null);

  const all = projects.data ?? [];
  const needle = search.trim().toLowerCase();
  const list = all.filter(
    ({ project }) => needle === '' || project.name.toLowerCase().includes(needle) || project.domain.includes(needle),
  );

  let content;

  if (projects.loading) {
    content = (
      <Card>
        <TableSkeleton rows={5} columns={6} />
      </Card>
    );
  } else if (projects.error !== null && projects.data === undefined) {
    content = (
      <Card>
        <ErrorState message={describeError(projects.error)} onRetry={projects.reload} />
      </Card>
    );
  } else if (all.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to start monitoring URLs."
          action={
            <LinkButton href="/projects/new" variant="primary" icon={Plus}>
              Create your first project
            </LinkButton>
          }
        />
      </Card>
    );
  } else {
    content = (
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <SearchInput className="w-full sm:w-72" label="Search projects" placeholder="Search projects" value={search} onChange={setSearch} />
          <span className="px-1 text-[13px] text-muted">{pluralize(all.length, 'project')}</span>
        </div>

        {list.length === 0 ? (
          <EmptyState icon={SearchX} title="No projects match" description="Try a different name or domain." />
        ) : (
          <>
            <div className="hidden md:block">
              <TableContainer>
                <Table>
                  <THead>
                    <Th>Project</Th>
                    <Th className="text-right">URLs</Th>
                    <Th className="text-right">Inspected</Th>
                    <Th className="text-right">Indexed</Th>
                    <Th>Status</Th>
                    <Th>IndexNow</Th>
                    <Th>Updated</Th>
                    <Th className="text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </THead>
                  <TBody>
                    {list.map((entry) => (
                      <Tr key={entry.project.id}>
                        <Td>
                          <Link href={`/projects/${entry.project.id}`} className="font-medium text-foreground hover:text-primary">
                            {entry.project.name}
                          </Link>
                          <p className="flex items-center gap-1.5 text-[13px] text-muted">
                            <Globe className="size-3" aria-hidden="true" />
                            {entry.project.domain}
                          </p>
                        </Td>
                        <Td className="text-right tabular-nums">{entry.summary ? formatNumber(entry.summary.totalUrls) : '—'}</Td>
                        <Td className="text-right tabular-nums">
                          {entry.summary ? formatNumber(entry.summary.inspection.inspected) : '—'}
                        </Td>
                        <Td className="text-right tabular-nums" title="As reported by Google Search Console">
                          {entry.summary ? formatNumber(entry.summary.google.indexed) : '—'}
                        </Td>
                        <Td>
                          <ProjectStatus summary={entry.summary} />
                        </Td>
                        <Td>
                          <KeyBadge project={entry.project} />
                        </Td>
                        <Td className="whitespace-nowrap text-muted">
                          <span title={formatDateTime(entry.project.updatedAt)}>{formatRelative(entry.project.updatedAt)}</span>
                        </Td>
                        <Td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Pencil} label={`Edit ${entry.project.name}`} onClick={() => setEditing(entry.project)} />
                            <IconButton
                              icon={Trash2}
                              label={`Delete ${entry.project.name}`}
                              variant="danger-ghost"
                              onClick={() => setDeleting(entry)}
                            />
                            <LinkButton href={`/projects/${entry.project.id}`} size="sm" variant="ghost" iconRight={ArrowRight}>
                              Open
                            </LinkButton>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {list.map((entry) => (
                <li key={entry.project.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/projects/${entry.project.id}`} className="font-medium text-foreground hover:text-primary">
                        {entry.project.name}
                      </Link>
                      <p className="truncate text-[13px] text-muted">{entry.project.domain}</p>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <IconButton icon={Pencil} label={`Edit ${entry.project.name}`} onClick={() => setEditing(entry.project)} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${entry.project.name}`}
                        variant="danger-ghost"
                        onClick={() => setDeleting(entry)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ProjectStatus summary={entry.summary} />
                    <KeyBadge project={entry.project} />
                  </div>
                  {entry.summary ? (
                    <p className="text-[13px] text-muted tabular-nums">
                      {pluralize(entry.summary.totalUrls, 'URL')} · {formatNumber(entry.summary.inspection.inspected)} inspected ·{' '}
                      {formatNumber(entry.summary.google.indexed)} indexed
                    </p>
                  ) : null}
                  <LinkButton href={`/projects/${entry.project.id}`} size="sm" className="w-full" iconRight={ArrowRight}>
                    Open project
                  </LinkButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Manage the websites you want to monitor and index."
        actions={
          <LinkButton href="/projects/new" variant="primary" icon={Plus}>
            New project
          </LinkButton>
        }
      />
      {content}
      <EditProjectDialog
        project={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          projects.reload();
        }}
      />
      <DeleteProjectDialog
        project={deleting?.project ?? null}
        urlCount={deleting?.summary?.totalUrls ?? null}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          projects.reload();
        }}
      />
    </>
  );
}
