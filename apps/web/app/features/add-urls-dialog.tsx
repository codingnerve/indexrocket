'use client';

import { CircleCheck, Plus, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Checkbox, Field, fieldAria, Input, Textarea } from '../components/ui/form';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/cn';
import { formatNumber, pluralize } from '../lib/format';
import { useAction } from '../lib/hooks';
import type { AddUrlResponse, BulkImportResponse, Project } from '../lib/types';

/** Matches MAX_BULK_URLS in the API. */
const MAX_BULK_URLS = 500;

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function SingleUrlForm({ project, onAdded, onClose }: { project: Project; onAdded: () => void; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [url, setUrl] = useState('');
  const [inspectNow, setInspectNow] = useState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const added = await run(
      'add-url',
      () => apiFetch<AddUrlResponse>(`/api/projects/${project.id}/urls`, { method: 'POST', body: JSON.stringify({ url }) }),
      {
        success: (json) => (json.created ? 'URL added' : 'Already tracked'),
        successDescription: (json) => (json.created ? null : 'This URL is already part of the project.'),
        errorTitle: 'Couldn’t add the URL',
      },
    );

    if (added === undefined) {
      return;
    }

    if (inspectNow) {
      await run(
        'inspect-new',
        () =>
          apiFetch('/api/urls/inspect', {
            method: 'POST',
            body: JSON.stringify({ projectId: project.id, url: added.data.url }),
          }),
        { success: 'Inspection queued', errorTitle: 'Couldn’t start inspection' },
      );
    }

    onAdded();
    onClose();
  };

  const busy = isPending('add-url') || isPending('inspect-new');

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field id="single-url" label="URL" hint={`Must belong to ${project.domain}.`}>
        <Input
          {...fieldAria('single-url', null, true)}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={`https://${project.domain}/page`}
          required
          autoFocus
        />
      </Field>
      <label className="flex items-center gap-2.5 text-[13px] text-foreground">
        <Checkbox checked={inspectNow} onChange={(event) => setInspectNow(event.target.checked)} />
        Inspect it right away
      </label>
      <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={Plus} loading={busy} disabled={url.trim() === ''}>
          Add URL
        </Button>
      </div>
    </form>
  );
}

function BulkImportForm({ project, onAdded, onClose }: { project: Project; onAdded: () => void; onClose: () => void }) {
  const { run, isPending } = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<BulkImportResponse | null>(null);
  const lines = parseLines(text);
  const tooMany = lines.length > MAX_BULK_URLS;

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const json = await run(
      'bulk-import',
      () =>
        apiFetch<BulkImportResponse>(`/api/projects/${project.id}/urls/bulk`, {
          method: 'POST',
          body: JSON.stringify({ urls: lines }),
        }),
      {
        success: (response) => `Imported ${pluralize(response.summary.created, 'URL')}`,
        errorTitle: 'Import failed',
      },
    );

    if (json !== undefined) {
      setResult(json);
      setText('');
      onAdded();
    }
  };

  if (result !== null) {
    const rejected = result.results.filter((entry) => entry.status === 'rejected');

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border p-3.5">
          <CircleCheck className="mt-0.5 size-4 text-success" aria-hidden="true" />
          <div className="text-[13px]">
            <p className="font-medium text-foreground">Import finished</p>
            <p className="mt-1 flex flex-wrap gap-2">
              <Badge tone="success">{formatNumber(result.summary.created)} added</Badge>
              <Badge tone="neutral">{formatNumber(result.summary.duplicates)} duplicates</Badge>
              <Badge tone={rejected.length > 0 ? 'danger' : 'neutral'}>{formatNumber(result.summary.rejected)} rejected</Badge>
            </p>
          </div>
        </div>
        {rejected.length > 0 ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-foreground">Rejected URLs</p>
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border text-[13px]">
              {rejected.map((entry, index) => (
                <li key={`${entry.url}-${index}`} className="px-3 py-2">
                  <p className="truncate font-mono text-xs text-foreground" title={entry.url}>
                    {entry.url}
                  </p>
                  <p className="text-xs text-danger">{entry.reason ?? 'Invalid URL.'}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted">Adding URLs doesn’t inspect them. Select them in the table to inspect and submit.</p>
        <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
          <Button onClick={() => setResult(null)}>Import more</Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field
        id="bulk-urls"
        label="URLs"
        hint={`One URL per line, up to ${MAX_BULK_URLS}. Each must belong to ${project.domain}.`}
        error={tooMany ? `That’s ${formatNumber(lines.length)} URLs — the limit is ${MAX_BULK_URLS} per import.` : null}
      >
        <Textarea
          {...fieldAria('bulk-urls', tooMany ? 'too many' : null, true)}
          className="min-h-44 font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`https://${project.domain}/\nhttps://${project.domain}/about`}
          spellCheck={false}
          autoFocus
        />
      </Field>
      <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-subtle/50 px-5 py-3">
        <span className="text-xs text-muted tabular-nums">{pluralize(lines.length, 'URL')}</span>
        <div className="flex gap-2">
          <Button onClick={onClose} disabled={isPending('bulk-import')}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Upload}
            loading={isPending('bulk-import')}
            disabled={lines.length === 0 || tooMany}
          >
            Import
          </Button>
        </div>
      </div>
    </form>
  );
}

function AddUrlsBody({ project, onAdded, onClose }: { project: Project; onAdded: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="How to add URLs" className="inline-flex rounded-md border border-border bg-subtle p-0.5">
        {(
          [
            ['single', 'Single URL'],
            ['bulk', 'Bulk import'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'h-7 rounded-[5px] px-3 text-xs font-medium transition-colors',
              mode === value ? 'bg-card text-foreground shadow-xs' : 'text-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'single' ? (
        <SingleUrlForm project={project} onAdded={onAdded} onClose={onClose} />
      ) : (
        <BulkImportForm project={project} onAdded={onAdded} onClose={onClose} />
      )}
    </div>
  );
}

export function AddUrlsDialog({
  open,
  onClose,
  project,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  onAdded: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Add URLs" description={`Track pages on ${project.domain}.`}>
      <AddUrlsBody project={project} onAdded={onAdded} onClose={onClose} />
    </Dialog>
  );
}
