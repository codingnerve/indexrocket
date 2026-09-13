'use client';

import { BadgeCheck, Globe, Link2Off, RefreshCw, ScanSearch, ShieldCheck, Unplug } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';

import { Badge } from '@/app/components/ui/badge';
import { Button, IconButton } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader } from '@/app/components/ui/card';
import { ConfirmDialog } from '@/app/components/ui/dialog';
import { Alert, EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/app/components/ui/feedback';
import { Field, fieldAria, Input, Select } from '@/app/components/ui/form';
import { DetailList, PageHeader } from '@/app/components/ui/misc';
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/app/components/ui/table';
import { useToast } from '@/app/components/ui/toast';
import {
  GoogleResultPanel,
  isGoogleNotConfigured,
  permissionLabel,
  startGoogleConnect,
  useGoogleConnection,
  useSearchConsoleProperties,
} from '@/app/features/google';
import { apiFetch, describeError } from '@/app/lib/api';
import { describeSiteUrl, formatDateTime } from '@/app/lib/format';
import { useAction } from '@/app/lib/hooks';
import type { ApiData, GoogleConnection, GoogleInspectionSnapshot, SearchConsoleProperty } from '@/app/lib/types';

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/webmasters.readonly': 'Search Console — read only',
};

/** Fixed wording for the OAuth callback outcome; the raw query value is never rendered. */
function callbackMessage(error: string | null): string {
  if (error === 'access_denied') return 'Access was declined on Google’s consent screen.';
  if (error === 'token_exchange_failed') return 'Google didn’t complete the connection. Please try again.';

  return 'Google returned an error. Please try again.';
}

function StatusBadge({ connection }: { connection: GoogleConnection }) {
  if (connection.connected) {
    return (
      <Badge tone="success" dot>
        Connected
      </Badge>
    );
  }

  if (connection.status === 'expired' || connection.status === 'revoked' || connection.status === 'error') {
    return <Badge tone="warning">Reconnect required</Badge>;
  }

  return <Badge tone="neutral">Not connected</Badge>;
}

function InspectCard({ properties }: { properties: SearchConsoleProperty[] }) {
  const { run, isPending } = useAction();
  const [siteUrl, setSiteUrl] = useState(properties[0]?.siteUrl ?? '');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<GoogleInspectionSnapshot | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const json = await run(
      'inspect',
      () =>
        apiFetch<ApiData<GoogleInspectionSnapshot>>('/api/google/search-console/inspect', {
          method: 'POST',
          body: JSON.stringify({ inspectionUrl: url, siteUrl }),
        }),
      { success: 'Google inspection complete', errorTitle: 'Google inspection failed' },
    );

    if (json !== undefined) setResult(json.data);
  };

  return (
    <Card>
      <CardHeader
        title="Inspect a URL with Google"
        icon={ScanSearch}
        description="Runs Google’s URL Inspection API. If the URL is tracked in one of your projects, the result is saved to it."
      />
      <CardBody className="space-y-5">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
          <Field id="gsc-property" label="Property">
            <Select {...fieldAria('gsc-property')} value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)}>
              {properties.map((property) => (
                <option key={property.siteUrl} value={property.siteUrl}>
                  {property.siteUrl}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="gsc-url" label="URL">
            <Input
              {...fieldAria('gsc-url')}
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/page"
              autoComplete="off"
              required
            />
          </Field>
          <Button type="submit" variant="primary" icon={ScanSearch} loading={isPending('inspect')} disabled={siteUrl === '' || url.trim() === ''}>
            Inspect
          </Button>
        </form>
        {result !== null ? (
          <div className="rounded-lg border border-border p-4 animate-fade-in">
            <GoogleResultPanel result={result} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function GoogleView() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { run, isPending } = useAction();
  const handledCallback = useRef(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const connection = useGoogleConnection();
  const current = connection.data?.data;
  const connected = current?.connected === true;
  const properties = useSearchConsoleProperties(connected);

  // The OAuth callback lands here with ?connected=true|false[&error=...].
  useEffect(() => {
    if (handledCallback.current) return;

    const outcome = params.get('connected');

    if (outcome === null && params.get('error') === null) return;

    handledCallback.current = true;

    if (outcome === 'true') {
      toast.success('Google connected', 'Search Console is ready to use.');
    } else {
      toast.error('Google connection failed', callbackMessage(params.get('error')));
    }

    router.replace('/google', { scroll: false });
  }, [params, router, toast]);

  const connect = () => void run('connect', startGoogleConnect, { errorTitle: 'Couldn’t start the Google connection' });

  const disconnect = async () => {
    const json = await run(
      'disconnect',
      () => apiFetch<{ revokedAtGoogle: boolean }>('/api/google/connection', { method: 'DELETE' }),
      {
        success: 'Google disconnected',
        successDescription: (response) =>
          response.revokedAtGoogle ? 'Access was also revoked at Google.' : 'The connection was removed from IndexRocket.',
        errorTitle: 'Couldn’t disconnect Google',
      },
    );

    if (json !== undefined) {
      setDisconnectOpen(false);
      connection.reload();
    }
  };

  const notConfigured = isGoogleNotConfigured(connection.error);
  const list = properties.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Google Search Console"
        description="Connect Search Console to read Google’s own verdict on whether your pages are indexed."
        actions={
          current === undefined || notConfigured ? null : connected ? (
            <>
              <Button icon={RefreshCw} onClick={connect} loading={isPending('connect')}>
                Reconnect
              </Button>
              <Button icon={Unplug} variant="danger-ghost" onClick={() => setDisconnectOpen(true)}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button variant="primary" icon={BadgeCheck} onClick={connect} loading={isPending('connect')}>
              Connect Google
            </Button>
          )
        }
      />

      {connection.loading ? (
        <div className="space-y-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : notConfigured ? (
        <Card>
          <EmptyState
            icon={Link2Off}
            title="Google integration isn’t available"
            description="This server has no Google OAuth credentials configured, so Search Console can’t be connected."
          />
        </Card>
      ) : current === undefined ? (
        <Card>
          <ErrorState message={describeError(connection.error)} onRetry={connection.reload} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader title="Connection" icon={BadgeCheck} action={<StatusBadge connection={current} />} />
              <CardBody>
                {connected ? (
                  <DetailList
                    items={[
                      { label: 'Status', value: <StatusBadge connection={current} /> },
                      { label: 'Connected since', value: current.connectedAt ? formatDateTime(current.connectedAt) : null },
                      {
                        label: 'Access',
                        value:
                          current.scopes.length > 0 ? (
                            <span className="flex flex-wrap gap-1.5">
                              {current.scopes.map((scope) => (
                                <Badge key={scope} tone="neutral">
                                  {SCOPE_LABELS[scope] ?? scope}
                                </Badge>
                              ))}
                            </span>
                          ) : null,
                      },
                      { label: 'Google account', value: current.googleAccountId },
                    ]}
                  />
                ) : (
                  <EmptyState
                    icon={BadgeCheck}
                    title={current.status === null ? 'Not connected' : 'Reconnect required'}
                    description="Connect Search Console to inspect URLs with Google."
                    action={
                      <Button variant="primary" icon={BadgeCheck} onClick={connect} loading={isPending('connect')}>
                        Connect Google
                      </Button>
                    }
                    className="py-8"
                  />
                )}
              </CardBody>
            </Card>

            {connected ? (
              <Card className="overflow-hidden">
                <CardHeader
                  title="Properties"
                  icon={Globe}
                  description="Search Console properties the connected account can access."
                  action={<IconButton icon={RefreshCw} label="Refresh properties" onClick={properties.reload} loading={properties.refreshing} />}
                />
                {properties.loading ? (
                  <TableSkeleton rows={3} columns={3} />
                ) : properties.error !== null && properties.data === undefined ? (
                  <ErrorState message={describeError(properties.error)} onRetry={properties.reload} />
                ) : list.length === 0 ? (
                  <EmptyState
                    icon={Globe}
                    title="No properties"
                    description="Add and verify your site in Google Search Console, then refresh."
                  />
                ) : (
                  <TableContainer>
                    <Table className="min-w-[520px]">
                      <THead>
                        <Th>Property</Th>
                        <Th>Type</Th>
                        <Th>Permission</Th>
                      </THead>
                      <TBody>
                        {list.map((property) => (
                          <Tr key={property.siteUrl}>
                            <Td className="font-mono text-[13px] break-all">{property.siteUrl}</Td>
                            <Td>
                              <Badge tone={describeSiteUrl(property.siteUrl).kind === 'domain' ? 'primary' : 'neutral'}>
                                {describeSiteUrl(property.siteUrl).label}
                              </Badge>
                            </Td>
                            <Td className="text-muted">{permissionLabel(property.permissionLevel)}</Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  </TableContainer>
                )}
              </Card>
            ) : null}

            {connected && list.length > 0 ? <InspectCard properties={list} /> : null}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Google’s verdict" icon={ShieldCheck} />
              <CardBody className="space-y-3 text-[13px] leading-5 text-muted">
                <p>
                  Google’s URL Inspection API is the only source in IndexRocket that can say whether a page is indexed. It’s
                  kept separate from our own inspection and from IndexNow notifications.
                </p>
                <p>Access is read-only. You can disconnect at any time; IndexRocket also revokes the access at Google.</p>
              </CardBody>
            </Card>
            {!connected ? (
              <Alert tone="info" title="Before you connect">
                Your site needs to be a verified property in Google Search Console for the account you connect.
              </Alert>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={() => void disconnect()}
        loading={isPending('disconnect')}
        title="Disconnect Google Search Console?"
        description="IndexRocket removes the stored connection and revokes its access at Google. Results already saved to your URLs stay."
        confirmLabel="Disconnect"
      />
    </>
  );
}

export default function GooglePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <GoogleView />
    </Suspense>
  );
}
