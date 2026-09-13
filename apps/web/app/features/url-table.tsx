'use client';

import { ArrowUpRight, Link2, Plus, RefreshCw, ScanSearch, SearchX, Send, Trash2, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  CanonicalBadge,
  GoogleStatusBadge,
  HttpStatusCode,
  IndexNowStatusBadge,
  isUrlBusy,
  UrlInspectionBadge,
} from '../components/status';
import { Button, IconButton } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/dialog';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/feedback';
import { Checkbox, Select } from '../components/ui/form';
import { SearchInput, UrlText } from '../components/ui/misc';
import { Pagination } from '../components/ui/navigation';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '../components/ui/table';
import { apiFetch, describeError } from '../lib/api';
import { formatDateTime, formatNumber, formatRelative, humanize, pluralize } from '../lib/format';
import { useAction, useDebouncedValue, useResource } from '../lib/hooks';
import { URL_STATUS_FILTERS, type InspectResponse, type Paginated, type Project, type UrlView } from '../lib/types';
import { AddUrlsDialog } from './add-urls-dialog';
import { MAX_BATCH_URLS, SubmitBatchDialog } from './submit-batch-dialog';

const PAGE_SIZE = 25;
/** After the user starts work, keep watching for results for this long. */
const WATCH_MS = 90_000;
const POLL_MS = 4_000;

export function urlHref(url: Pick<UrlView, 'id' | 'projectId'>): string {
  return `/projects/${url.projectId}/urls/${url.id}`;
}

/**
 * The URL workspace: search, filter, paginate, select, inspect, notify and
 * submit. Everything is backed by the project's URL API; statuses refresh on
 * their own while server-side work for a visible row is still running.
 */
export function UrlTable({
  project,
  initialStatus = 'all',
  onChanged,
}: {
  project: Project;
  initialStatus?: string;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [deleting, setDeleting] = useState<UrlView | null>(null);
  const watchUntil = useRef(0);
  const query = useDebouncedValue(search.trim(), 300);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });

  if (query !== '') params.set('search', query);
  if (status !== 'all') params.set('status', status);

  const urls = useResource<Paginated<UrlView>>(`/api/projects/${project.id}/urls?${params.toString()}`, undefined, {
    poll: (data) => (Date.now() < watchUntil.current || data.data.some(isUrlBusy) ? POLL_MS : null),
  });

  const rows = urls.data?.data ?? [];
  const pagination = urls.data?.pagination;
  const filtered = query !== '' || status !== 'all';

  const afterWork = () => {
    watchUntil.current = Date.now() + WATCH_MS;
    urls.reload();
    onChanged?.();
  };

  const inspect = async (row: UrlView) => {
    const result = await run(
      `inspect:${row.id}`,
      () =>
        apiFetch<InspectResponse>('/api/urls/inspect', {
          method: 'POST',
          body: JSON.stringify({ projectId: project.id, url: row.url }),
        }),
      { success: 'Inspection queued', successDescription: 'The result appears here automatically.', errorTitle: 'Couldn’t start inspection' },
    );

    if (result !== undefined) afterWork();
  };

  const notify = async (row: UrlView) => {
    const result = await run(`notify:${row.id}`, () => apiFetch(`/api/urls/${row.id}/discover`, { method: 'POST' }), {
      success: 'IndexNow notification queued',
      successDescription: 'Acceptance means the notification was received — not that the page is indexed.',
      errorTitle: 'Can’t notify IndexNow',
    });

    if (result !== undefined) afterWork();
  };

  const remove = async () => {
    if (deleting === null) return;

    const target = deleting;
    const result = await run(
      'delete-url',
      () => apiFetch(`/api/projects/${project.id}/urls/${target.id}`, { method: 'DELETE' }),
      { success: 'URL deleted', errorTitle: 'Couldn’t delete the URL' },
    );

    if (result !== undefined) {
      setDeleting(null);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(target.id);

        return next;
      });
      urls.reload();
      onChanged?.();
    }
  };

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const pageIds = rows.map((row) => row.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allOnPage = pageIds.length > 0 && selectedOnPage === pageIds.length;

  const togglePage = () => {
    setSelected((current) => {
      const next = new Set(current);

      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }

      return next;
    });
  };

  let body;

  if (urls.loading) {
    body = <TableSkeleton rows={8} columns={6} />;
  } else if (urls.error !== null && urls.data === undefined) {
    body = <ErrorState message={describeError(urls.error)} onRetry={urls.reload} />;
  } else if (rows.length === 0) {
    body = filtered ? (
      <EmptyState
        icon={SearchX}
        title="No URLs match your filters"
        description="Try a different search or status."
        action={
          <Button
            size="sm"
            onClick={() => {
              setSearch('');
              setStatus('all');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Link2}
        title="No URLs yet"
        description="Add URLs to start inspecting and submitting pages."
        action={
          <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>
            Add URLs
          </Button>
        }
      />
    );
  } else {
    body = (
      <TableContainer>
        <Table className="min-w-[1040px]">
          <THead>
            <Th className="w-10 pr-0">
              <Checkbox
                aria-label="Select all URLs on this page"
                checked={allOnPage}
                ref={(element) => {
                  if (element !== null) element.indeterminate = selectedOnPage > 0 && !allOnPage;
                }}
                onChange={togglePage}
              />
            </Th>
            <Th>URL</Th>
            <Th>Inspection</Th>
            <Th>HTTP</Th>
            <Th>Canonical</Th>
            <Th>Google</Th>
            <Th>IndexNow</Th>
            <Th>Last inspected</Th>
            <Th className="text-right">
              <span className="sr-only">Actions</span>
            </Th>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.id} selected={selected.has(row.id)}>
                <Td className="pr-0">
                  <Checkbox aria-label={`Select ${row.url}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </Td>
                <Td className="max-w-[340px]">
                  <UrlText url={row.url} href={urlHref(row)} copy />
                  {row.error ? (
                    <p className="mt-0.5 max-w-[320px] truncate text-xs text-danger" title={row.error}>
                      {row.error}
                    </p>
                  ) : null}
                </Td>
                <Td>
                  <UrlInspectionBadge status={row.status} />
                </Td>
                <Td>
                  <HttpStatusCode code={row.httpStatus} />
                </Td>
                <Td>
                  <CanonicalBadge type={row.canonicalType} />
                </Td>
                <Td>
                  <GoogleStatusBadge status={row.googleInspection?.status} />
                </Td>
                <Td>
                  <IndexNowStatusBadge status={row.discovery.indexNow.status} />
                  {row.discovery.indexNow.submittedAt ? (
                    <p className="mt-0.5 text-xs text-muted" title={formatDateTime(row.discovery.indexNow.submittedAt)}>
                      {formatRelative(row.discovery.indexNow.submittedAt)}
                    </p>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  <span title={formatDateTime(row.lastInspectedAt)}>
                    {row.lastInspectedAt ? formatRelative(row.lastInspectedAt) : 'Never'}
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-0.5">
                    <IconButton
                      icon={ScanSearch}
                      label="Inspect"
                      onClick={() => void inspect(row)}
                      loading={isPending(`inspect:${row.id}`)}
                    />
                    <IconButton
                      icon={Zap}
                      label="Notify via IndexNow"
                      onClick={() => void notify(row)}
                      loading={isPending(`notify:${row.id}`)}
                    />
                    <Link
                      href={urlHref(row)}
                      aria-label="View details"
                      title="View details"
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-foreground"
                    >
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                    <IconButton icon={Trash2} label="Delete URL" variant="danger-ghost" onClick={() => setDeleting(row)} />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchInput
            className="w-full sm:w-72"
            label="Search URLs"
            placeholder="Search URLs"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
          <Select
            className="w-full sm:w-44"
            aria-label="Filter by inspection status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            {URL_STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <IconButton icon={RefreshCw} label="Refresh" onClick={urls.reload} loading={urls.refreshing} />
            <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>
              Add URLs
            </Button>
          </div>
        </div>

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary-soft/50 px-4 py-2.5 text-[13px] animate-fade-in">
            <span className="font-medium text-foreground">{pluralize(selected.size, 'URL')} selected</span>
            <Button size="sm" variant="primary" icon={Send} onClick={() => setSubmitOpen(true)} disabled={selected.size > MAX_BATCH_URLS}>
              Submit selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            {selected.size > MAX_BATCH_URLS ? (
              <span className="text-danger">A batch can include at most {MAX_BATCH_URLS} URLs.</span>
            ) : (
              <span className="text-muted">Inspection, then IndexNow where eligible. Google’s status is a separate check.</span>
            )}
          </div>
        ) : null}

        {body}

        {pagination && rows.length > 0 ? (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            noun="URLs"
            onPageChange={setPage}
            disabled={urls.refreshing}
          />
        ) : null}
      </Card>

      <AddUrlsDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        project={project}
        onAdded={() => {
          afterWork();
        }}
      />

      <SubmitBatchDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        project={project}
        urlIds={[...selected]}
        onSubmitted={(batchId) => {
          setSubmitOpen(false);
          setSelected(new Set());
          router.push(`/projects/${project.id}/batches/${batchId}`);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        loading={isPending('delete-url')}
        title="Delete this URL?"
        description="It stops being tracked and its inspection history is removed. This can’t be undone."
        confirmLabel="Delete URL"
      >
        {deleting ? <p className="rounded-md bg-subtle px-3 py-2 font-mono text-xs break-all text-foreground">{deleting.url}</p> : null}
      </ConfirmDialog>

      {pagination ? <p className="sr-only" aria-live="polite">{`${formatNumber(pagination.total)} URLs`}</p> : null}
    </>
  );
}
