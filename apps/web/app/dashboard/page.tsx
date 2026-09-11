'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../lib/api';
import { card, ErrorNote, muted, shell, TopBar } from '../lib/ui';
import { useSession } from '../lib/useSession';

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  hasIndexNowKey: boolean;
  createdAt: string;
}

interface Summary {
  totalUrls: number;
  inspection: { pending: number; inspected: number; failed: number };
  google: { indexed: number; notIndexed: number; unknown: number; notInspected: number };
  indexNow: { accepted: number; failed: number; pending: number; notSubmitted: number };
}

export default function DashboardPage() {
  const { user, loading, signOut } = useSession();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');

    try {
      const json = await apiFetch<{ data: ProjectRow[] }>('/api/projects');
      setProjects(json.data);

      // Each project's counts come from its own summary endpoint, which reads
      // the three status families from three separate fields.
      const entries = await Promise.all(
        json.data.map(async (project) => {
          try {
            const summary = await apiFetch<{ data: Summary }>(`/api/projects/${project.id}/summary`);

            return [project.id, summary.data] as const;
          } catch {
            return null;
          }
        }),
      );

      setSummaries(Object.fromEntries(entries.filter((entry) => entry !== null)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load projects.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user !== null) {
      void load();
    }
  }, [user, load]);

  if (loading) {
    return <main style={shell}>Loading…</main>;
  }

  if (user === null) {
    return <main style={shell}>Redirecting to sign in…</main>;
  }

  return (
    <main style={shell}>
      <TopBar email={user.email} onSignOut={() => void signOut()} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Projects</h1>
        <Link href="/projects/new">
          <button>New project</button>
        </Link>
      </div>

      <p style={{ ...muted, marginTop: 4 }}>
        Inspection is what we measured. Google is what Google reported. IndexNow is whether a
        notification was accepted — never a claim about indexing.
      </p>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {busy && projects.length === 0 ? <p>Loading projects…</p> : null}

      {!busy && projects.length === 0 ? (
        <div style={card}>
          <p style={{ marginTop: 0 }}>No projects yet.</p>
          <Link href="/projects/new">Create your first project</Link>
        </div>
      ) : null}

      {projects.map((project) => {
        const summary = summaries[project.id];

        return (
          <div key={project.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <Link href={`/projects/${project.id}`} style={{ fontSize: 17, fontWeight: 600 }}>
                  {project.name}
                </Link>
                <div style={{ ...muted, fontSize: 13 }}>
                  {project.domain}
                  {project.hasIndexNowKey ? ' · IndexNow key configured' : ' · no IndexNow key'}
                </div>
              </div>
              <Link href={`/projects/${project.id}`}>
                <button>Open</button>
              </Link>
            </div>

            {summary ? (
              <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
                <span>
                  <strong>{summary.totalUrls}</strong> <span style={muted}>URLs</span>
                </span>
                <span>
                  <strong>{summary.inspection.inspected}</strong> <span style={muted}>inspected</span>
                </span>
                <span>
                  <strong>{summary.google.indexed}</strong>{' '}
                  <span style={muted}>indexed (Google)</span>
                </span>
                <span>
                  <strong>{summary.indexNow.accepted}</strong>{' '}
                  <span style={muted}>notified (IndexNow)</span>
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
