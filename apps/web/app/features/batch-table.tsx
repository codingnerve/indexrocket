'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { BatchStatusBadge, isLiveBatch } from '../components/status';
import { ProgressBar } from '../components/ui/misc';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '../components/ui/table';
import { formatDateTime, formatNumber, formatRelative, shortId } from '../lib/format';
import type { Batch } from '../lib/types';

export type BatchRow = Batch & { projectName?: string; projectDomain?: string };

export function batchHref(batch: Pick<Batch, 'id' | 'projectId'>): string {
  return `/projects/${batch.projectId}/batches/${batch.id}`;
}

/** Submission history. Every number is the batch's own reconciled counter. */
export function BatchTable({ batches, showProject = false }: { batches: BatchRow[]; showProject?: boolean }) {
  return (
    <TableContainer>
      <Table className="min-w-[760px]">
        <THead>
          <Th>Batch</Th>
          {showProject ? <Th>Project</Th> : null}
          <Th>Progress</Th>
          <Th className="text-right">Total</Th>
          <Th className="text-right">Completed</Th>
          <Th className="text-right">Failed</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          <Th className="w-10">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <TBody>
          {batches.map((batch) => {
            const done = batch.completed + batch.failed + batch.skipped;

            return (
              <Tr key={batch.id}>
                <Td>
                  <Link href={batchHref(batch)} className="font-mono text-[13px] font-medium text-foreground hover:text-primary">
                    #{shortId(batch.id)}
                  </Link>
                  {batch.inspectGoogle ? <p className="text-xs text-muted">with Google check</p> : null}
                </Td>
                {showProject ? (
                  <Td>
                    <p className="max-w-48 truncate font-medium">{batch.projectName ?? '—'}</p>
                    {batch.projectDomain ? <p className="max-w-48 truncate text-xs text-muted">{batch.projectDomain}</p> : null}
                  </Td>
                ) : null}
                <Td className="w-48">
                  <div className="flex items-center gap-2.5">
                    <ProgressBar
                      value={done}
                      max={batch.total}
                      label={`${done} of ${batch.total} finished`}
                      tone={isLiveBatch(batch.status) ? 'info' : batch.failed > 0 ? 'warning' : 'success'}
                    />
                    <span className="text-xs whitespace-nowrap text-muted tabular-nums">
                      {formatNumber(done)}/{formatNumber(batch.total)}
                    </span>
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{formatNumber(batch.total)}</Td>
                <Td className="text-right tabular-nums">{formatNumber(batch.completed)}</Td>
                <Td className={batch.failed > 0 ? 'text-right text-danger tabular-nums' : 'text-right tabular-nums'}>
                  {formatNumber(batch.failed)}
                </Td>
                <Td>
                  <BatchStatusBadge status={batch.status} />
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  <span title={formatDateTime(batch.createdAt)}>{formatRelative(batch.createdAt)}</span>
                </Td>
                <Td>
                  <Link
                    href={batchHref(batch)}
                    aria-label={`View batch ${shortId(batch.id)}`}
                    title="View details"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-foreground"
                  >
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableContainer>
  );
}
