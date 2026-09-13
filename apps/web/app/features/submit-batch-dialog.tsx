'use client';

import { Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Alert } from '../components/ui/feedback';
import { Checkbox, Field, fieldAria, Select } from '../components/ui/form';
import { apiFetch } from '../lib/api';
import { describeSiteUrl, formatNumber, pluralize, propertyForDomain } from '../lib/format';
import { useAction } from '../lib/hooks';
import type { CreateBatchResponse, Project } from '../lib/types';
import { useGoogleConnection, useSearchConsoleProperties } from './google';

/** Matches MAX_BATCH_URLS in the API. */
export const MAX_BATCH_URLS = 200;

function SubmitBatchForm({
  project,
  urlIds,
  onClose,
  onSubmitted,
}: {
  project: Project;
  urlIds: string[];
  onClose: () => void;
  onSubmitted: (batchId: string) => void;
}) {
  const { run, isPending } = useAction();
  const connection = useGoogleConnection();
  const connected = connection.data?.data.connected === true;
  const properties = useSearchConsoleProperties(connected);
  const [inspectGoogle, setInspectGoogle] = useState(false);
  const [choice, setChoice] = useState('');

  const list = properties.data?.data ?? [];
  const siteUrl = choice !== '' ? choice : (propertyForDomain(list, project.domain)?.siteUrl ?? list[0]?.siteUrl ?? '');
  const tooMany = urlIds.length > MAX_BATCH_URLS;

  const submit = async () => {
    const result = await run(
      'submit-batch',
      () =>
        apiFetch<CreateBatchResponse>(`/api/projects/${project.id}/batches`, {
          method: 'POST',
          body: JSON.stringify(inspectGoogle ? { urlIds, inspectGoogle: true, googleSiteUrl: siteUrl } : { urlIds }),
        }),
      {
        success: 'Submission started',
        successDescription: (json) =>
          json.summary.alreadyInFlight > 0
            ? `${pluralize(json.summary.queued, 'URL')} queued · ${formatNumber(json.summary.alreadyInFlight)} already in another batch`
            : `${pluralize(json.summary.queued, 'URL')} queued`,
        errorTitle: 'Couldn’t start the submission',
      },
    );

    if (result !== undefined) {
      onSubmitted(result.data.id);
    }
  };

  return (
    <div className="space-y-4">
      <ol className="space-y-2 text-[13px] leading-5 text-muted">
        <li>
          <span className="font-medium text-foreground">1. Inspect</span> — each URL is fetched and checked (HTTP
          status, robots.txt, canonical, sitemap).
        </li>
        <li>
          <span className="font-medium text-foreground">2. Notify</span> — eligible URLs are sent to IndexNow. A URL is
          notified at most once every 24 hours.
        </li>
        <li>
          <span className="font-medium text-foreground">3. Google (optional)</span> — each URL is checked with Google’s
          URL Inspection API.
        </li>
      </ol>

      {!project.hasIndexNowKey ? (
        <Alert tone="warning" title="No IndexNow key for this project">
          URLs will still be inspected, but IndexNow notifications will be skipped.
        </Alert>
      ) : null}

      {tooMany ? (
        <Alert tone="danger" title={`A batch can include at most ${MAX_BATCH_URLS} URLs`}>
          Reduce the selection and try again.
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border p-3.5">
        <label className="flex items-start gap-3">
          <Checkbox
            className="mt-0.5"
            checked={inspectGoogle}
            disabled={!connected || list.length === 0}
            onChange={(event) => setInspectGoogle(event.target.checked)}
          />
          <span>
            <span className="block text-[13px] font-medium text-foreground">Also check each URL with Google</span>
            <span className="block text-xs leading-5 text-muted">
              {connection.loading
                ? 'Checking your Google connection…'
                : !connected
                  ? (
                      <>
                        Search Console isn’t connected.{' '}
                        <Link href="/google" className="font-medium text-primary hover:underline">
                          Connect Google
                        </Link>
                      </>
                    )
                  : list.length === 0 && !properties.loading
                    ? 'The connected account has no Search Console properties.'
                    : 'Uses your Search Console property and its daily inspection quota.'}
            </span>
          </span>
        </label>

        {inspectGoogle && list.length > 0 ? (
          <Field id="batch-property" label="Property" className="mt-3 pl-7">
            <Select {...fieldAria('batch-property')} value={siteUrl} onChange={(event) => setChoice(event.target.value)}>
              {list.map((property) => (
                <option key={property.siteUrl} value={property.siteUrl}>
                  {property.siteUrl} · {describeSiteUrl(property.siteUrl).label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
        <Button onClick={onClose} disabled={isPending('submit-batch')}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={Send}
          onClick={() => void submit()}
          loading={isPending('submit-batch')}
          disabled={tooMany || urlIds.length === 0 || (inspectGoogle && siteUrl === '')}
        >
          Submit {pluralize(urlIds.length, 'URL')}
        </Button>
      </div>
    </div>
  );
}

export function SubmitBatchDialog({
  open,
  onClose,
  project,
  urlIds,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  urlIds: string[];
  onSubmitted: (batchId: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Submit ${pluralize(urlIds.length, 'URL')}`}
      description="Starts a submission batch you can follow live."
    >
      <SubmitBatchForm project={project} urlIds={urlIds} onClose={onClose} onSubmitted={onSubmitted} />
    </Dialog>
  );
}
