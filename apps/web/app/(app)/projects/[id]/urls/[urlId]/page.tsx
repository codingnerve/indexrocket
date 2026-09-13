'use client';

import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  LinkIcon,
  ScanSearch,
  Trash2,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  GoogleStatusBadge,
  HttpStatusCode,
  IndexNowStatusBadge,
  isUrlBusy,
  UrlInspectionBadge,
} from '@/app/components/status';
import { Button, IconButton, LinkButton } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader } from '@/app/components/ui/card';
import { ConfirmDialog } from '@/app/components/ui/dialog';
import { Alert, EmptyState, ErrorState, Skeleton, Spinner } from '@/app/components/ui/feedback';
import { CopyButton, DetailList, PageHeader } from '@/app/components/ui/misc';
import { useToast } from '@/app/components/ui/toast';
import { GoogleInspectDialog, GoogleResultPanel } from '@/app/features/google';
import { apiFetch, ApiError, describeError } from '@/app/lib/api';
import { cn } from '@/app/lib/cn';
import { formatDateTime, formatRelative, humanize } from '@/app/lib/format';
import { useAction, useResource } from '@/app/lib/hooks';
import type { ApiData, Project, UrlView } from '@/app/lib/types';

/** After the user starts work, keep watching for the result for this long. */
const WATCH_MS = 120_000;

type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';

const CHECK_STYLE: Record<CheckState, { icon: LucideIcon; className: string; label: string }> = {
  pass: { icon: CircleCheck, className: 'text-success', label: 'Passed' },
  warn: { icon: TriangleAlert, className: 'text-warning', label: 'Warning' },
  fail: { icon: CircleX, className: 'text-danger', label: 'Failed' },
  unknown: { icon: CircleDashed, className: 'text-muted', label: 'Not determined' },
};

interface Check {
  state: CheckState;
  title: string;
  detail?: string | null;
}

/** Translates the stored inspection fields into plain-language checks. Nothing is inferred. */
function inspectionChecks(url: UrlView): Check[] {
  const checks: Check[] = [];

  if (url.httpStatus === null) {
    checks.push({ state: 'unknown', title: 'HTTP status not available', detail: url.error ?? 'The page hasn’t been fetched yet.' });
  } else {
    const code = url.httpStatus;
    const detail = [
      url.responseTimeMs !== null ? `${url.responseTimeMs} ms` : null,
      url.contentType,
      url.redirectCount ? `${url.redirectCount} redirect${url.redirectCount === 1 ? '' : 's'}` : null,
      url.finalUrl !== null && url.finalUrl !== url.url ? `Final URL: ${url.finalUrl}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    checks.push({
      state: code >= 200 && code < 300 ? 'pass' : code >= 300 && code < 400 ? 'warn' : 'fail',
      title: `HTTP ${code}${code >= 200 && code < 300 ? ' — fetch successful' : ''}`,
      detail: detail || null,
    });
  }

  if (url.robotsAllowed === true) {
    checks.push({ state: 'pass', title: 'Allowed by robots.txt', detail: url.robotsUserAgent ? `Evaluated for ${url.robotsUserAgent}` : null });
  } else if (url.robotsAllowed === false) {
    checks.push({ state: 'fail', title: 'Blocked by robots.txt', detail: url.robotsUserAgent ? `Evaluated for ${url.robotsUserAgent}` : null });
  } else {
    checks.push({
      state: 'unknown',
      title: url.robotsReachable === false ? 'robots.txt couldn’t be reached' : 'robots.txt not evaluated',
    });
  }

  switch (url.canonicalType) {
    case 'self':
      checks.push({ state: 'pass', title: 'Canonical points to this URL', detail: url.canonical });
      break;
    case 'different':
      checks.push({ state: 'warn', title: 'Canonical points to another URL', detail: url.canonical });
      break;
    case 'missing':
      checks.push({ state: 'warn', title: 'No canonical tag found' });
      break;
    case 'invalid':
      checks.push({ state: 'fail', title: 'Invalid canonical tag', detail: url.canonical });
      break;
    default:
      checks.push({ state: 'unknown', title: 'Canonical not checked' });
  }

  if (url.sitemapFound === true) {
    checks.push(
      url.urlInSitemap === true
        ? { state: 'pass', title: 'Listed in the sitemap', detail: url.sitemapUrl }
        : url.urlInSitemap === false
          ? { state: 'warn', title: 'Not listed in the sitemap', detail: url.sitemapUrl }
          : { state: 'unknown', title: 'Sitemap membership unknown', detail: url.sitemapUrl },
    );
  } else if (url.sitemapFound === false) {
    checks.push({ state: 'warn', title: 'No sitemap found' });
  } else {
    checks.push({ state: 'unknown', title: 'Sitemap not checked' });
  }

  return checks;
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-border">
      {checks.map((check) => {
        const style = CHECK_STYLE[check.state];

        return (
          <li key={check.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <style.icon className={cn('mt-0.5 size-4 shrink-0', style.className)} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {check.title}
                <span className="sr-only"> ({style.label})</span>
              </p>
              {check.detail ? <p className="mt-0.5 text-[13px] break-words text-muted">{check.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function titleFor(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export default function UrlDetailPage() {
  const { id, urlId } = useParams<{ id: string; urlId: string }>();
  const router = useRouter();
  const toast = useToast();
  const { run, isPending } = useAction();
  const watchUntil = useRef(0);
  const previousStatus = useRef<string | null>(null);
  const [googleOpen, setGoogleOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const project = useResource<ApiData<Project>>(`/api/projects/${id}`);
  const url = useResource<ApiData<UrlView>>(`/api/projects/${id}/urls/${urlId}`, undefined, {
    poll: (json) =>
      isUrlBusy(json.data) || (Date.now() < watchUntil.current && json.data.status === 'queued') ? 3000 : null,
  });

  const detail = url.data?.data;
  const status = detail?.status ?? null;

  // Announce the outcome of an inspection the user started from this page.
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = status;

    if (before === null || status === null || before === status || Date.now() > watchUntil.current) return;

    if ((before === 'queued' || before === 'processing') && status === 'inspected') {
      toast.success('Inspection complete');
    } else if ((before === 'queued' || before === 'processing') && status === 'failed') {
      toast.error('Inspection failed', 'See the details below.');
    }
  }, [status, toast]);

  if (url.loading) {
    return (
      <div role="status" aria-label="Loading URL" className="space-y-6">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-8 w-96 max-w-full" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (detail === undefined) {
    const notFound = url.error instanceof ApiError && (url.error.status === 404 || url.error.status === 400);

    return (
      <Card>
        {notFound ? (
          <EmptyState
            icon={LinkIcon}
            title="URL not found"
            description="It may have been deleted from this project."
            action={<LinkButton href={`/projects/${id}?tab=urls`}>Back to URLs</LinkButton>}
          />
        ) : (
          <ErrorState message={describeError(url.error)} onRetry={url.reload} />
        )}
      </Card>
    );
  }

  const projectData = project.data?.data;
  const neverInspected = detail.lastInspectedAt === null && detail.httpStatus === null;
  // Derived from data only: the worker is running the check, or our request is in flight.
  const inspecting = detail.status === 'processing' || isPending('inspect');

  const watch = () => {
    watchUntil.current = Date.now() + WATCH_MS;
    url.reload();
  };

  const inspect = async () => {
    const result = await run(
      'inspect',
      () => apiFetch('/api/urls/inspect', { method: 'POST', body: JSON.stringify({ projectId: id, url: detail.url }) }),
      { success: 'Inspection queued', successDescription: 'This page updates when the check finishes.', errorTitle: 'Couldn’t start inspection' },
    );

    if (result !== undefined) watch();
  };

  const notify = async () => {
    const result = await run('notify', () => apiFetch(`/api/urls/${detail.id}/discover`, { method: 'POST' }), {
      success: 'IndexNow notification queued',
      successDescription: 'Acceptance means the notification was received — not that the page is indexed.',
      errorTitle: 'Can’t notify IndexNow',
    });

    if (result !== undefined) watch();
  };

  const remove = async () => {
    const result = await run('delete', () => apiFetch(`/api/projects/${id}/urls/${detail.id}`, { method: 'DELETE' }), {
      success: 'URL deleted',
      errorTitle: 'Couldn’t delete the URL',
    });

    if (result !== undefined) router.replace(`/projects/${id}?tab=urls`);
  };

  const indexNow = detail.discovery.indexNow;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: projectData?.name ?? 'Project', href: `/projects/${id}` },
          { label: 'URLs', href: `/projects/${id}?tab=urls` },
          { label: 'URL details' },
        ]}
        title={titleFor(detail.url)}
        meta={
          <>
            <span className="flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-muted">
              <span className="truncate" title={detail.url}>
                {detail.url}
              </span>
              <CopyButton value={detail.url} label="Copy URL" />
              <a
                href={detail.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Open the page in a new tab"
                title="Open the page"
                className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-subtle hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </span>
            <UrlInspectionBadge status={detail.status} />
            <GoogleStatusBadge status={detail.googleInspection?.status} />
            <IndexNowStatusBadge status={indexNow.status} />
          </>
        }
        actions={
          <>
            <Button variant="primary" icon={ScanSearch} onClick={() => void inspect()} loading={isPending('inspect')}>
              {neverInspected ? 'Inspect' : 'Inspect again'}
            </Button>
            <Button icon={Zap} onClick={() => void notify()} loading={isPending('notify')}>
              Notify IndexNow
            </Button>
            <Button icon={BadgeCheck} onClick={() => setGoogleOpen(true)}>
              Check with Google
            </Button>
            <IconButton icon={Trash2} label="Delete URL" variant="danger-ghost" size="md" onClick={() => setDeleteOpen(true)} />
          </>
        }
      />

      {inspecting ? (
        <Alert tone="info" title="Inspection in progress" className="mb-6" action={<Spinner />}>
          This page updates automatically when the check finishes.
        </Alert>
      ) : null}
      {indexNow.status === 'pending' ? (
        <Alert tone="info" title="Sending IndexNow notification" className="mb-6" action={<Spinner />}>
          The status below updates when the provider responds.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Inspection"
            icon={ScanSearch}
            description="What IndexRocket measured itself."
            action={
              detail.lastInspectedAt ? (
                <span className="text-xs text-muted" title={formatDateTime(detail.lastInspectedAt)}>
                  {formatRelative(detail.lastInspectedAt)}
                </span>
              ) : null
            }
          />
          <CardBody>
            {neverInspected && !inspecting ? (
              <EmptyState
                icon={ScanSearch}
                title="Not inspected yet"
                description="Run an inspection to check HTTP status, robots.txt, canonical and sitemap."
                action={
                  <Button variant="primary" size="sm" icon={ScanSearch} onClick={() => void inspect()} loading={isPending('inspect')}>
                    Inspect now
                  </Button>
                }
                className="py-6"
              />
            ) : (
              <div className="space-y-5">
                {detail.status === 'failed' && detail.error ? (
                  <Alert tone="danger" title="Inspection failed">
                    {detail.error}
                  </Alert>
                ) : null}
                <CheckList checks={inspectionChecks(detail)} />
                <DetailList
                  className="border-t border-border pt-2"
                  items={[
                    { label: 'HTTP status', value: detail.httpStatus === null ? null : <HttpStatusCode code={detail.httpStatus} /> },
                    { label: 'Final URL', value: detail.finalUrl !== detail.url ? detail.finalUrl : null },
                    { label: 'Content type', value: detail.contentType },
                    { label: 'Response time', value: detail.responseTimeMs === null ? null : `${detail.responseTimeMs} ms` },
                    { label: 'Canonical', value: detail.canonical },
                    { label: 'Sitemap', value: detail.sitemapUrl },
                  ]}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Google Search Console"
            icon={BadgeCheck}
            description="Reported by Google — the only source that can say a page is indexed."
          />
          <CardBody>
            {detail.googleInspection === null ? (
              <EmptyState
                icon={BadgeCheck}
                title="Not checked with Google yet"
                description="Connect Search Console to inspect URLs with Google."
                action={
                  <Button size="sm" icon={BadgeCheck} onClick={() => setGoogleOpen(true)}>
                    Check with Google
                  </Button>
                }
                className="py-6"
              />
            ) : (
              <GoogleResultPanel result={detail.googleInspection} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="IndexNow"
            icon={Zap}
            description="Whether a notification was accepted. Acceptance isn’t indexing."
          />
          <CardBody className="space-y-4">
            {projectData !== undefined && !projectData.hasIndexNowKey ? (
              <Alert tone="warning" title="No IndexNow key for this project">
                Notifications can’t be sent until a key is configured.
              </Alert>
            ) : null}
            <DetailList
              items={[
                { label: 'Status', value: <IndexNowStatusBadge status={indexNow.status} /> },
                { label: 'Last notified', value: indexNow.submittedAt ? formatDateTime(indexNow.submittedAt) : null },
                { label: 'Response code', value: indexNow.responseCode === null ? null : <HttpStatusCode code={indexNow.responseCode} /> },
                { label: 'Last error', value: indexNow.lastError },
              ]}
            />
            <p className="text-xs leading-5 text-muted">
              Before sending, IndexRocket checks eligibility — including the 24-hour cooldown per URL. If a URL isn’t
              eligible, you’ll see the reason.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Timeline" icon={Clock} />
          <CardBody>
            <DetailList
              items={[
                { label: 'Added', value: formatDateTime(detail.createdAt) },
                { label: 'Submitted', value: detail.submittedAt ? formatDateTime(detail.submittedAt) : null },
                { label: 'Last checked', value: detail.lastCheckedAt ? formatDateTime(detail.lastCheckedAt) : null },
                { label: 'Last inspected', value: detail.lastInspectedAt ? formatDateTime(detail.lastInspectedAt) : null },
                {
                  label: 'Checked with Google',
                  value: detail.googleInspection?.inspectedAt ? formatDateTime(detail.googleInspection.inspectedAt) : null,
                },
                { label: 'Notified via IndexNow', value: indexNow.submittedAt ? formatDateTime(indexNow.submittedAt) : null },
                { label: 'Inspection status', value: humanize(detail.status) },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <GoogleInspectDialog
        open={googleOpen}
        onClose={() => setGoogleOpen(false)}
        url={detail}
        domain={projectData?.domain ?? ''}
        onDone={() => {
          setGoogleOpen(false);
          url.reload();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void remove()}
        loading={isPending('delete')}
        title="Delete this URL?"
        description="It stops being tracked and its inspection history is removed. This can’t be undone."
        confirmLabel="Delete URL"
      />
    </>
  );
}
