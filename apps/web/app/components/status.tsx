import { humanize } from '../lib/format';
import { TERMINAL_BATCH_STATUSES, type UrlView } from '../lib/types';
import { Badge } from './ui/badge';

/**
 * Status vocabulary.
 *
 * Three families are rendered with deliberately different wording so a reader
 * is never invited to equate them:
 *   - Inspection: what IndexRocket measured itself (Url.status).
 *   - Google:     what Google Search Console reported. The ONLY source that may
 *                 say "Indexed".
 *   - IndexNow:   whether a notification was accepted. Rendered as "Notified",
 *                 never "Indexed". See docs/DISCOVERY.md.
 */

export function UrlInspectionBadge({ status }: { status: string }) {
  switch (status) {
    case 'queued':
      return (
        <Badge tone="neutral" dot title="Waiting to be inspected">
          Queued
        </Badge>
      );
    case 'processing':
      return (
        <Badge tone="info" dot pulse>
          Inspecting
        </Badge>
      );
    case 'inspected':
      return <Badge tone="success">Inspected</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    default:
      // Legacy values are shown verbatim and never styled as a Google verdict.
      return <Badge tone="neutral">{humanize(status)}</Badge>;
  }
}

export function GoogleStatusBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case 'indexed':
      return (
        <Badge tone="success" title="Google Search Console reports this URL is on Google">
          Indexed
        </Badge>
      );
    case 'not_indexed':
      return (
        <Badge tone="danger" title="Google Search Console reports this URL is not on Google">
          Not indexed
        </Badge>
      );
    case 'unknown':
      return (
        <Badge tone="warning" title="Google returned a verdict that could not be mapped with confidence">
          Inconclusive
        </Badge>
      );
    case 'error':
      return (
        <Badge tone="warning" title="The Google inspection could not be completed">
          Check failed
        </Badge>
      );
    default:
      return <Badge tone="neutral">Not checked</Badge>;
  }
}

export function IndexNowStatusBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case 'accepted':
      return (
        <Badge tone="info" title="An IndexNow endpoint accepted the notification. This is not a statement about indexing.">
          Notified
        </Badge>
      );
    case 'pending':
      return (
        <Badge tone="primary" dot pulse>
          Sending
        </Badge>
      );
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    default:
      return <Badge tone="neutral">Not notified</Badge>;
  }
}

export function BatchStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <Badge tone="neutral" dot>
          Queued
        </Badge>
      );
    case 'processing':
      return (
        <Badge tone="info" dot pulse>
          Processing
        </Badge>
      );
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'completed_with_errors':
      return <Badge tone="warning">Completed with errors</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    case 'cancelled':
      return <Badge tone="neutral">Cancelled</Badge>;
    default:
      return <Badge tone="neutral">{humanize(status)}</Badge>;
  }
}

export function BatchItemStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <Badge tone="neutral" dot>
          Queued
        </Badge>
      );
    case 'processing':
      return (
        <Badge tone="info" dot pulse>
          Processing
        </Badge>
      );
    case 'completed':
      return <Badge tone="success">Completed</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    case 'skipped':
      return <Badge tone="warning">Skipped</Badge>;
    default:
      return <Badge tone="neutral">{humanize(status)}</Badge>;
  }
}

const STAGE_SUCCESS = { inspection: 'Inspected', discovery: 'Notified', google: 'Checked' } as const;

/** Per-stage outcome inside a batch item. "Notified" is never rendered as "Indexed". */
export function StageBadge({ stage, outcome }: { stage: keyof typeof STAGE_SUCCESS; outcome: string }) {
  switch (outcome) {
    case 'succeeded':
      return <Badge tone={stage === 'discovery' ? 'info' : 'success'}>{STAGE_SUCCESS[stage]}</Badge>;
    case 'failed':
      return <Badge tone="danger">Failed</Badge>;
    case 'skipped':
      return <Badge tone="warning">Skipped</Badge>;
    default:
      return <Badge tone="neutral">Not run</Badge>;
  }
}

export function CanonicalBadge({ type }: { type: string | null }) {
  switch (type) {
    case 'self':
      return <Badge tone="success">Self</Badge>;
    case 'different':
      return <Badge tone="warning">Points elsewhere</Badge>;
    case 'missing':
      return <Badge tone="neutral">Missing</Badge>;
    case 'invalid':
      return <Badge tone="danger">Invalid</Badge>;
    default:
      return <span className="text-muted">—</span>;
  }
}

export function GoogleVerdictBadge({ verdict }: { verdict: string | null }) {
  if (verdict === null) {
    return <span className="text-muted">—</span>;
  }

  const tone = verdict === 'PASS' ? 'success' : verdict === 'FAIL' ? 'danger' : verdict === 'PARTIAL' ? 'warning' : 'neutral';

  return <Badge tone={tone}>{verdict}</Badge>;
}

export function HttpStatusCode({ code }: { code: number | null }) {
  if (code === null) {
    return <span className="text-muted">—</span>;
  }

  const color = code >= 200 && code < 300 ? 'text-success' : code >= 300 && code < 400 ? 'text-info' : 'text-danger';

  return <span className={`font-mono text-[13px] font-medium ${color}`}>{code}</span>;
}

export function isLiveBatch(status: string): boolean {
  return !TERMINAL_BATCH_STATUSES.includes(status);
}

/** True while real work for this URL is running server-side. */
export function isUrlBusy(url: Pick<UrlView, 'status' | 'discovery'>): boolean {
  return url.status === 'processing' || url.discovery.indexNow.status === 'pending';
}
