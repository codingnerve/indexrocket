import { apiFetch, ApiError } from './api';
import type { ApiData, Batch, GoogleConnection, Paginated, Project, ProjectSummary } from './types';

/**
 * Loaders that combine several real API calls. The API has no cross-project
 * listing for batches, so cross-project views merge each project's own list.
 */

export interface ProjectWithSummary {
  project: Project;
  /** null when this project's summary could not be loaded. */
  summary: ProjectSummary | null;
}

export interface BatchWithProject extends Batch {
  projectName: string;
  projectDomain: string;
}

export async function loadProjects(): Promise<Project[]> {
  return (await apiFetch<ApiData<Project[]>>('/api/projects')).data;
}

export async function loadSummary(projectId: string): Promise<ProjectSummary | null> {
  try {
    return (await apiFetch<ApiData<ProjectSummary>>(`/api/projects/${projectId}/summary`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    return null;
  }
}

export async function loadProjectsWithSummaries(): Promise<ProjectWithSummary[]> {
  const projects = await loadProjects();
  const summaries = await Promise.all(projects.map((project) => loadSummary(project.id)));

  return projects.map((project, index) => ({ project, summary: summaries[index] ?? null }));
}

/** The most recent batches across the given projects, newest first. */
export async function loadRecentBatches(projects: Project[], perProject: number): Promise<BatchWithProject[]> {
  const lists = await Promise.all(
    projects.map(async (project) => {
      try {
        const json = await apiFetch<Paginated<Batch>>(`/api/projects/${project.id}/batches?limit=${perProject}`);

        return json.data.map((batch) => ({ ...batch, projectName: project.name, projectDomain: project.domain }));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }

        return [];
      }
    }),
  );

  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type GoogleAvailability =
  | { state: 'available'; connection: GoogleConnection }
  | { state: 'not-configured' }
  | { state: 'unavailable' };

/** Google status for overview screens; never throws except on an expired session. */
export async function loadGoogleAvailability(): Promise<GoogleAvailability> {
  try {
    const json = await apiFetch<ApiData<GoogleConnection>>('/api/google/connection');

    return { state: 'available', connection: json.data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }

    return error instanceof ApiError && error.status === 503 ? { state: 'not-configured' } : { state: 'unavailable' };
  }
}
