'use client';

import { ScanSearch } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '../components/ui/button';
import { ConfirmDialog, Dialog } from '../components/ui/dialog';
import { Alert } from '../components/ui/feedback';
import { Field, fieldAria, Input } from '../components/ui/form';
import { apiFetch, ApiError, describeError } from '../lib/api';
import { pluralize } from '../lib/format';
import { useAction } from '../lib/hooks';
import type { ApiData, InspectResponse, Project } from '../lib/types';

/** Edits name and/or domain. The API refuses a domain change while URLs exist. */
export function ProjectForm({
  project,
  onSaved,
  onCancel,
  submitLabel = 'Save changes',
}: {
  project: Project;
  onSaved: (project: Project) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { run, isPending } = useAction();
  const [name, setName] = useState(project.name);
  const [domain, setDomain] = useState(project.domain);
  const [error, setError] = useState<string | null>(null);
  const changes: Record<string, string> = {};

  if (name.trim() !== project.name) changes.name = name.trim();
  if (domain.trim() !== project.domain) changes.domain = domain.trim();

  const dirty = Object.keys(changes).length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const json = await run(
      'save-project',
      () => apiFetch<ApiData<Project>>(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
      {
        success: 'Project updated',
        errorTitle: 'Couldn’t update the project',
        onError: (caught) => setError(describeError(caught)),
      },
    );

    if (json !== undefined) onSaved(json.data);
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="project-name" label="Project name">
        <Input {...fieldAria('project-name')} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required />
      </Field>
      <Field
        id="project-domain"
        label="Domain"
        hint="Can only change while the project has no URLs. Changing it clears the IndexNow key, which belongs to the old host."
      >
        <Input
          {...fieldAria('project-domain', null, true)}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button onClick={onCancel} disabled={isPending('save-project')}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={isPending('save-project')} disabled={!dirty || name.trim() === ''}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function EditProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  return (
    <Dialog open={project !== null} onClose={onClose} title="Edit project" description={project?.domain}>
      {project ? <ProjectForm project={project} onCancel={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

export function DeleteProjectDialog({
  project,
  urlCount,
  onClose,
  onDeleted,
}: {
  project: Project | null;
  urlCount: number | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { run, isPending } = useAction();

  const confirm = async () => {
    if (project === null) return;

    const result = await run(
      'delete-project',
      () => apiFetch<{ deletedUrls: number }>(`/api/projects/${project.id}`, { method: 'DELETE' }),
      {
        success: 'Project deleted',
        successDescription: (json) => `${pluralize(json.deletedUrls, 'URL')} removed.`,
        errorTitle: 'Couldn’t delete the project',
      },
    );

    if (result !== undefined) onDeleted();
  };

  return (
    <ConfirmDialog
      open={project !== null}
      onClose={onClose}
      onConfirm={() => void confirm()}
      loading={isPending('delete-project')}
      title={`Delete ${project?.name ?? 'project'}?`}
      description={
        urlCount === null
          ? 'The project and every URL it tracks are permanently deleted.'
          : `The project and its ${pluralize(urlCount, 'tracked URL')} are permanently deleted.`
      }
      confirmLabel="Delete project"
    >
      <p className="text-[13px] leading-5 text-muted">
        Notifications already sent to IndexNow and results stored by Google are not affected. This can’t be undone.
      </p>
    </ConfirmDialog>
  );
}

function InspectUrlForm({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const json = await run(
      'inspect-url',
      () =>
        apiFetch<InspectResponse>('/api/urls/inspect', {
          method: 'POST',
          body: JSON.stringify({ projectId: project.id, url }),
        }),
      {
        success: 'Inspection queued',
        successDescription: 'Opening the URL — results appear as soon as the check finishes.',
        errorTitle: 'Couldn’t start inspection',
        onError: (caught) => setError(caught instanceof ApiError ? describeError(caught) : null),
      },
    );

    if (json !== undefined) {
      onClose();
      router.push(`/projects/${project.id}/urls/${json.urlId}`);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="inspect-url" label="URL" hint="We fetch the page and check HTTP status, robots.txt, canonical and sitemap. The URL is added to the project if it’s new.">
        <Input
          {...fieldAria('inspect-url', null, true)}
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={`https://${project.domain}/page`}
          autoComplete="off"
          required
          autoFocus
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} disabled={isPending('inspect-url')}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={ScanSearch} loading={isPending('inspect-url')} disabled={url.trim() === ''}>
          Inspect
        </Button>
      </div>
    </form>
  );
}

export function InspectUrlDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  return (
    <Dialog open={open} onClose={onClose} title="Inspect a URL" description={`Run IndexRocket’s own checks on a page of ${project.domain}.`}>
      <InspectUrlForm project={project} onClose={onClose} />
    </Dialog>
  );
}
