import type { Segment } from '../components/ui/misc';
import type { ProjectSummary } from './types';

export const EMPTY_SUMMARY: ProjectSummary = {
  totalUrls: 0,
  inspection: { pending: 0, inspected: 0, failed: 0 },
  google: { indexed: 0, notIndexed: 0, unknown: 0, notInspected: 0 },
  indexNow: { accepted: 0, failed: 0, pending: 0, notSubmitted: 0 },
};

/** Adds real per-project summaries together; missing summaries count as nothing. */
export function combineSummaries(summaries: Array<ProjectSummary | null>): ProjectSummary {
  return summaries.reduce<ProjectSummary>(
    (total, summary) =>
      summary === null
        ? total
        : {
            totalUrls: total.totalUrls + summary.totalUrls,
            inspection: {
              pending: total.inspection.pending + summary.inspection.pending,
              inspected: total.inspection.inspected + summary.inspection.inspected,
              failed: total.inspection.failed + summary.inspection.failed,
            },
            google: {
              indexed: total.google.indexed + summary.google.indexed,
              notIndexed: total.google.notIndexed + summary.google.notIndexed,
              unknown: total.google.unknown + summary.google.unknown,
              notInspected: total.google.notInspected + summary.google.notInspected,
            },
            indexNow: {
              accepted: total.indexNow.accepted + summary.indexNow.accepted,
              failed: total.indexNow.failed + summary.indexNow.failed,
              pending: total.indexNow.pending + summary.indexNow.pending,
              notSubmitted: total.indexNow.notSubmitted + summary.indexNow.notSubmitted,
            },
          },
    EMPTY_SUMMARY,
  );
}

export function inspectionSegments(summary: ProjectSummary): Segment[] {
  return [
    { label: 'Inspected', value: summary.inspection.inspected, tone: 'success' },
    { label: 'Pending', value: summary.inspection.pending, tone: 'info' },
    { label: 'Failed', value: summary.inspection.failed, tone: 'danger' },
  ];
}

export function googleSegments(summary: ProjectSummary): Segment[] {
  return [
    { label: 'Indexed', value: summary.google.indexed, tone: 'success' },
    { label: 'Not indexed', value: summary.google.notIndexed, tone: 'danger' },
    { label: 'Inconclusive', value: summary.google.unknown, tone: 'warning' },
    { label: 'Not checked', value: summary.google.notInspected, tone: 'neutral' },
  ];
}

export function indexNowSegments(summary: ProjectSummary): Segment[] {
  return [
    { label: 'Notified', value: summary.indexNow.accepted, tone: 'info' },
    { label: 'Sending', value: summary.indexNow.pending, tone: 'primary' },
    { label: 'Failed', value: summary.indexNow.failed, tone: 'danger' },
    { label: 'Not notified', value: summary.indexNow.notSubmitted, tone: 'neutral' },
  ];
}

/** URLs Google has given a definite answer about. */
export function googleChecked(summary: ProjectSummary): number {
  return summary.google.indexed + summary.google.notIndexed + summary.google.unknown;
}
