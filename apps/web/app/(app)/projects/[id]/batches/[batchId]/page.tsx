'use client';

import { Ban, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock, Layers, ListChecks, LoaderCircle, RefreshCw, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';

import { BatchItemStatusBadge, BatchStatusBadge, isLiveBatch, StageBadge } from '@/app/components/status';
import { Badge } from '@/app/components/ui/badge';
import { Button, IconButton } from '@/app/components/ui/button';
import { Card, CardHeader, StatCard } from '@/app/components/ui/card';
import { ConfirmDialog } from '@/app/components/ui/dialog';
import { Alert, EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/app/components/ui/feedback';
import { Select } from '@/app/components/ui/form';
import { DetailList, PageHeader, SegmentedBar, UrlText } from '@/app/components/ui/misc';
import { Pagination } from '@/app/components/ui/navigation';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/app/components/ui/table';
import { useToast } from '@/app/components/ui/toast';
import { apiFetch, ApiError, describeError } from '@/app/lib/api';
import { formatDateTime, formatNumber, formatPercent, formatRelative, humanize, shortId } from '@/app/lib/format';
import { useAction, useResource } from '@/app/lib/hooks';
import { BATCH_ITEM_STATUS_FILTERS, type ApiData, type Batch, type BatchItem, type Paginated, type Project } from '@/app/lib/types';

const ITEM_PAGE_SIZE = 50;
/** Poll while the batch is live; stop the moment it reaches a terminal state. */
const POLL_MS = 3000;

export default function BatchDetailPage() {
  const { id, batchId } = useParams<{ id: string; batchId: string }>();
  const toast = useToast();
  const { run, isPending } = useAction();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [cancelOpen, setCancelOpen] = useState(false);
  const live = useRef<boolean | undefined>(undefined);
  const previous = useRef<string | undefined>(undefined);

  const project = useResource<ApiData<Project>>(`/api/projects/${id}`);
  const batch = useResource<ApiData<Batch>>(`/api/projects/${id}/batches/${batchId}`, undefined, {
    poll: (json) => (isLiveBatch(json.data.status) ? POLL_MS : null),
  });

  const itemParams = new URLSearchParams({ page: String(page), limit: String(ITEM_PAGE_SIZE) });
  if (filter !== 'all') itemParams.set('status', filter);

  const items = useResource<Paginated<BatchItem>>(`/api/projects/${id}/batches/${batchId}/items?${itemParams.toString()}`, undefined, {
    // Until the batch status is known, keep polling; stop once it is terminal.
    poll: () => (live.current === false ? null : POLL_MS),
  });

  const status = batch.data?.data.status;
  const reloadItems = items.reload;

  useEffect(() => {
    if (status === undefined) return;

    live.current = isLiveBatch(status);

    const before = previous.current;
    previous.current = status;

    if (before !== undefined && isLiveBatch(before) && !isLiveBatch(status)) {
      reloadItems();

      if (status === 'completed') toast.success('Submission completed');
      else if (status === 'completed_with_errors') toast.info('Submission finished with errors', 'Some URLs failed — see the details below.');
      else if (status === 'failed') toast.error('Submission failed', 'No URL in this batch completed successfully.');
    }
  }, [status, reloadItems, toast]);

  const cancel = async () => {
    const result = await run(
      'cancel',
      () =>
        apiFetch<{ cancelledPending: number; stillProcessing: number; note: string }>(
          `/api/projects/${id}/batches/${batchId}/cancel`,
          { method: 'POST' },
        ),
      { success: 'Batch cancelled', successDescription: (json) => json.note, errorTitle: 'Couldn’t cancel the batch' },
    );

    if (result !== undefined) {
      setCancelOpen(false);
      batch.reload();
      items.reload();
    }
  };

  const toggle = (itemId: string) => {
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);

      return next;
    });
  };

  if (batch.loading) {
    return (
      <div role="status" aria-label="Loading batch" className="space-y-6">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-36" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (batch.data === undefined) {
    const notFound = batch.error instanceof ApiError && (batch.error.status === 404 || batch.error.status === 400);

    return (
      <Card>
        {notFound ? (
          <EmptyState icon={Layers} title="Batch not found" description="It may belong to another project or account." />
        ) : (
          <ErrorState message={describeError(batch.error)} onRetry={batch.reload} />
        )}
      </Card>
    );
  }

  const current = batch.data.data;
  const isLive = isLiveBatch(current.status);
  const finished = current.completed + current.failed + current.skipped;
  const rows = items.data?.data ?? [];
  const pagination = items.data?.pagination;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project.data?.data.name ?? 'Project', href: `/projects/${id}` },
          { label: 'Submissions', href: `/projects/${id}?tab=submissions` },
          { label: `Batch #${shortId(current.id)}` },
        ]}
        title={`Batch #${shortId(current.id)}`}
        meta={
          <>
            <BatchStatusBadge status={current.status} />
            {isLive ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                Updating live
              </span>
            ) : null}
            {current.inspectGoogle ? <Badge tone="primary">Google check · {current.googleSiteUrl ?? 'no property'}</Badge> : null}
          </>
        }
        actions={
          <>
            <IconButton icon={RefreshCw} label="Refresh" variant="secondary" size="md" onClick={() => { batch.reload(); items.reload(); }} loading={batch.refreshing} />
            {isLive ? (
              <Button icon={Ban} variant="danger-ghost" onClick={() => setCancelOpen(true)}>
                Cancel remaining
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[13px] text-muted">Progress</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {formatNumber(finished)} <span className="text-base font-normal text-muted">/ {formatNumber(current.total)} finished</span>
            </p>
          </div>
          <p className="text-sm font-medium text-foreground tabular-nums">{formatPercent(finished, current.total)}</p>
        </div>
        <div className="mt-4">
          <SegmentedBar
            label="Batch progress"
            segments={[
              { label: 'Completed', value: current.completed, tone: 'success' },
              { label: 'Failed', value: current.failed, tone: 'danger' },
              { label: 'Skipped', value: current.skipped, tone: 'warning' },
              { label: 'Processing', value: current.processing, tone: 'info' },
              { label: 'Queued', value: current.pending, tone: 'neutral' },
            ]}
          />
        </div>
        <DetailList
          className="mt-4 border-t border-border pt-2"
          items={[
            { label: 'Created', value: formatDateTime(current.createdAt) },
            { label: 'Started', value: current.startedAt ? formatDateTime(current.startedAt) : null },
            { label: 'Completed', value: current.completedAt ? formatDateTime(current.completedAt) : null },
            { label: 'Cancelled', value: current.cancelledAt ? formatDateTime(current.cancelledAt) : null },
          ]}
        />
      </Card>

      <section aria-label="Batch counts" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total" icon={Layers} value={formatNumber(current.total)} />
        <StatCard label="Queued" icon={Clock} value={formatNumber(current.pending)} />
        <StatCard label="Processing" icon={LoaderCircle} tone="info" value={formatNumber(current.processing)} />
        <StatCard label="Completed" icon={CircleCheck} tone="success" value={formatNumber(current.completed)} />
        <StatCard label="Failed" icon={CircleAlert} tone="danger" value={formatNumber(current.failed)} />
        <StatCard label="Skipped" icon={Ban} tone="warning" value={formatNumber(current.skipped)} />
      </section>

      {isLive ? (
        <Alert tone="info" className="mt-6">
          Cancelling stops URLs that haven’t started. A URL already in flight finishes, and an IndexNow notification
          that was already sent can’t be recalled.
        </Alert>
      ) : null}

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="URLs in this batch"
          icon={ListChecks}
          action={
            <Select
              aria-label="Filter by result"
              className="w-40"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All results</option>
              {BATCH_ITEM_STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'pending' ? 'Queued' : humanize(value)}
                </option>
              ))}
            </Select>
          }
        />
        {items.loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : items.error !== null && items.data === undefined ? (
          <ErrorState message={describeError(items.error)} onRetry={items.reload} />
        ) : rows.length === 0 ? (
          <EmptyState icon={SearchX} title={filter === 'all' ? 'No items' : 'No items with this result'} />
        ) : (
          <TableContainer>
            <Table className="min-w-[880px]">
              <THead>
                <Th className="w-10">
                  <span className="sr-only">Details</span>
                </Th>
                <Th>URL</Th>
                <Th>Result</Th>
                <Th>Inspection</Th>
                <Th>IndexNow</Th>
                <Th>Google</Th>
                <Th>Finished</Th>
              </THead>
              <TBody>
                {rows.map((item) => {
                  const open = expanded.has(item.id);
                  const hasDetail = item.errorMessage !== null || item.notes.length > 0 || item.attempts > 0;

                  return (
                    <Fragment key={item.id}>
                      <Tr>
                        <Td className="pr-0">
                          <IconButton
                            icon={open ? ChevronDown : ChevronRight}
                            label={open ? 'Hide details' : 'Show details'}
                            aria-expanded={open}
                            onClick={() => toggle(item.id)}
                            disabled={!hasDetail && item.startedAt === null}
                          />
                        </Td>
                        <Td className="max-w-[340px]">
                          <UrlText url={item.url} href={`/projects/${id}/urls/${item.urlId}`} copy />
                          {item.errorMessage ? (
                            <p className="mt-0.5 max-w-[320px] truncate text-xs text-danger" title={item.errorMessage}>
                              {item.errorMessage}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <BatchItemStatusBadge status={item.status} />
                        </Td>
                        <Td>
                          <StageBadge stage="inspection" outcome={item.inspectionStatus} />
                        </Td>
                        <Td>
                          <StageBadge stage="discovery" outcome={item.discoveryStatus} />
                        </Td>
                        <Td>
                          <StageBadge stage="google" outcome={item.googleStatus} />
                        </Td>
                        <Td className="whitespace-nowrap text-muted">
                          <span title={formatDateTime(item.completedAt)}>{item.completedAt ? formatRelative(item.completedAt) : '—'}</span>
                        </Td>
                      </Tr>
                      {open ? (
                        <tr className="bg-subtle/40">
                          <td />
                          <td colSpan={6} className="px-4 pt-1 pb-4">
                            <DetailList
                              items={[
                                {
                                  label: 'Error',
                                  value: item.errorMessage
                                    ? `${item.errorMessage}${item.errorCode ? ` (${humanize(item.errorCode)})` : ''}`
                                    : null,
                                },
                                {
                                  label: 'Notes',
                                  value:
                                    item.notes.length > 0 ? (
                                      <ul className="list-disc space-y-0.5 pl-4">
                                        {item.notes.map((note, index) => (
                                          <li key={index}>{note}</li>
                                        ))}
                                      </ul>
                                    ) : null,
                                },
                                { label: 'Attempts', value: item.attempts > 0 ? formatNumber(item.attempts) : null },
                                { label: 'Started', value: item.startedAt ? formatDateTime(item.startedAt) : null },
                                { label: 'Finished', value: item.completedAt ? formatDateTime(item.completedAt) : null },
                              ]}
                            />
                            <Link href={`/projects/${id}/urls/${item.urlId}`} className="mt-2 inline-block text-[13px] font-medium text-primary hover:underline">
                              Open URL details
                            </Link>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
        {pagination && rows.length > 0 ? (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            noun="URLs"
            onPageChange={setPage}
          />
        ) : null}
      </Card>

      <p className="mt-4 text-xs leading-5 text-muted">
        “Notified” means an IndexNow endpoint accepted the notification. It isn’t a statement about Google indexing — only
        the Google column reflects Google’s own report.
      </p>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancel()}
        loading={isPending('cancel')}
        title="Cancel the remaining URLs?"
        description="Queued URLs are skipped. URLs already being processed will finish."
        confirmLabel="Cancel remaining"
      />
    </>
  );
}
