'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, CircleX, ExternalLink, ScanSearch, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { GoogleVerdictBadge } from '../components/status';
import { Button, LinkButton } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Alert, LoadingState } from '../components/ui/feedback';
import { Field, fieldAria, Select } from '../components/ui/form';
import { DetailList } from '../components/ui/misc';
import { apiFetch, ApiError, describeError } from '../lib/api';
import { cn } from '../lib/cn';
import { describeSiteUrl, formatDateTime, humanize, propertyForDomain } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import type {
  ApiData,
  GoogleConnection,
  GoogleInspectionSnapshot,
  GoogleInspectionView,
  SearchConsoleProperty,
  UrlView,
} from '../lib/types';

/** Starts the existing server-side OAuth flow; the API returns Google's consent URL. */
export async function startGoogleConnect(): Promise<void> {
  const json = await apiFetch<{ authorizationUrl: string }>('/api/auth/google/start');

  // Only ever navigate to Google's own consent screen.
  if (!json.authorizationUrl.startsWith('https://accounts.google.com/')) {
    throw new ApiError('Unexpected authorization URL.', 500);
  }

  window.location.assign(json.authorizationUrl);
}

export function useGoogleConnection(enabled = true) {
  return useResource<ApiData<GoogleConnection>>(enabled ? '/api/google/connection' : null);
}

export function useSearchConsoleProperties(enabled: boolean) {
  return useResource<ApiData<SearchConsoleProperty[]>>(enabled ? '/api/google/search-console/properties' : null);
}

export function isGoogleNotConfigured(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

const PERMISSION_LABELS: Record<string, string> = {
  siteOwner: 'Owner',
  siteFullUser: 'Full user',
  siteRestrictedUser: 'Restricted user',
  siteUnverifiedUser: 'Unverified',
};

export function permissionLabel(level: string): string {
  return PERMISSION_LABELS[level] ?? humanize(level);
}

const OUTCOMES: Record<string, { label: string; description: string; icon: LucideIcon; tone: string }> = {
  indexed: {
    label: 'Indexed on Google',
    description: 'Google Search Console reports this URL is on Google.',
    icon: CircleCheck,
    tone: 'bg-success-soft text-success',
  },
  not_indexed: {
    label: 'Not indexed',
    description: 'Google Search Console reports this URL is not on Google.',
    icon: CircleX,
    tone: 'bg-danger-soft text-danger',
  },
  unknown: {
    label: 'Inconclusive',
    description: 'Google returned a verdict that doesn’t map to indexed or not indexed with confidence.',
    icon: TriangleAlert,
    tone: 'bg-warning-soft text-warning',
  },
  error: {
    label: 'Google check failed',
    description: 'The inspection could not be completed.',
    icon: CircleAlert,
    tone: 'bg-warning-soft text-warning',
  },
};

/** Google's result, exactly as reported. Fields Google did not return are hidden. */
export function GoogleResultPanel({ result }: { result: GoogleInspectionView | GoogleInspectionSnapshot }) {
  const outcome = OUTCOMES[result.status] ?? OUTCOMES.unknown!;
  const Icon = outcome.icon;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', outcome.tone)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{outcome.label}</p>
          <p className="text-[13px] text-muted">{result.coverageState ?? outcome.description}</p>
        </div>
      </div>

      {result.error ? <Alert tone="warning">{result.error}</Alert> : null}

      <DetailList
        items={[
          { label: 'Verdict', value: result.verdict === null ? null : <GoogleVerdictBadge verdict={result.verdict} /> },
          { label: 'Coverage', value: result.coverageState },
          { label: 'Indexing', value: result.indexingState === null ? null : humanize(result.indexingState) },
          { label: 'robots.txt', value: result.robotsTxtState === null ? null : humanize(result.robotsTxtState) },
          { label: 'Page fetch', value: result.pageFetchState === null ? null : humanize(result.pageFetchState) },
          { label: 'Last crawl', value: result.lastCrawlTime === null ? null : formatDateTime(result.lastCrawlTime) },
          { label: 'Crawled as', value: result.crawledAs === null ? null : humanize(result.crawledAs) },
          { label: 'Google canonical', value: result.googleCanonical },
          { label: 'Declared canonical', value: result.userCanonical },
          { label: 'Property', value: result.siteUrl },
          { label: 'Checked', value: result.inspectedAt === null ? null : formatDateTime(result.inspectedAt) },
        ]}
      />

      {result.inspectionResultLink ? (
        <a
          href={result.inspectionResultLink}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
        >
          Open in Search Console
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function GoogleInspectForm({
  url,
  domain,
  onClose,
  onDone,
}: {
  url: Pick<UrlView, 'id' | 'url'>;
  domain: string;
  onClose: () => void;
  onDone: (snapshot: GoogleInspectionSnapshot) => void;
}) {
  const connection = useGoogleConnection();
  const connected = connection.data?.data.connected === true;
  const properties = useSearchConsoleProperties(connected);
  const [choice, setChoice] = useState('');
  const { run, isPending } = useAction();

  if (connection.loading || (connected && properties.loading)) {
    return <LoadingState label="Checking your Google connection…" />;
  }

  if (isGoogleNotConfigured(connection.error)) {
    return <Alert tone="warning" title="Google integration isn’t configured">This server has no Google OAuth credentials.</Alert>;
  }

  if (connection.error) {
    return <Alert tone="danger">{describeError(connection.error)}</Alert>;
  }

  if (!connected) {
    return (
      <div className="space-y-4">
        <Alert tone="info" title="Connect Search Console to inspect URLs with Google">
          Google’s own URL Inspection API is the only source that can say whether a page is indexed.
        </Alert>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <LinkButton href="/google" variant="primary" icon={ScanSearch}>
            Connect Google
          </LinkButton>
        </div>
      </div>
    );
  }

  const list = properties.data?.data ?? [];
  const siteUrl = choice !== '' ? choice : (propertyForDomain(list, domain)?.siteUrl ?? list[0]?.siteUrl ?? '');

  const inspect = async () => {
    const result = await run(
      'google-inspect',
      () =>
        apiFetch<ApiData<GoogleInspectionSnapshot>>('/api/google/search-console/inspect', {
          method: 'POST',
          body: JSON.stringify({ inspectionUrl: url.url, siteUrl, urlId: url.id }),
        }),
      {
        success: 'Google inspection complete',
        successDescription: (json) => OUTCOMES[json.data.status]?.label ?? null,
        errorTitle: 'Google inspection failed',
      },
    );

    if (result !== undefined) {
      onDone(result.data);
    }
  };

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <Alert tone="warning" title="No Search Console properties">
          The connected Google account has no properties. Add and verify your site in Search Console first.
        </Alert>
      ) : (
        <Field
          id="google-property"
          label="Search Console property"
          hint="The property must cover this URL. Domain properties cover every subdomain and protocol."
        >
          <Select {...fieldAria('google-property', null, true)} value={siteUrl} onChange={(event) => setChoice(event.target.value)}>
            {list.map((property) => (
              <option key={property.siteUrl} value={property.siteUrl}>
                {property.siteUrl} · {describeSiteUrl(property.siteUrl).label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-xs leading-5 text-muted">
        The result is read from Google’s URL Inspection API and saved to this URL. Google limits how many inspections
        a property can run per day.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={isPending('google-inspect')}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={ScanSearch}
          onClick={() => void inspect()}
          loading={isPending('google-inspect')}
          disabled={siteUrl === ''}
        >
          Inspect with Google
        </Button>
      </div>
    </div>
  );
}

export function GoogleInspectDialog({
  open,
  onClose,
  url,
  domain,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  url: Pick<UrlView, 'id' | 'url'>;
  domain: string;
  onDone: (snapshot: GoogleInspectionSnapshot) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Check with Google Search Console" description={url.url}>
      <GoogleInspectForm url={url} domain={domain} onClose={onClose} onDone={onDone} />
    </Dialog>
  );
}
