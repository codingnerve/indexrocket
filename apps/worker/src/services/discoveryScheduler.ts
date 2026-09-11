import { Project, type UrlDocument } from '@indexrocket/database';
import { addDiscoveryJob } from '@indexrocket/queue';
import { evaluateDiscoveryEligibility, redactUrlForLog } from '@indexrocket/utils';

/**
 * Queues a discovery notification after a successful inspection.
 *
 * The gate is deliberate: a project only reaches this path once someone has
 * configured an IndexNow key for it, and the URL must pass the same eligibility
 * rules the API enforces. Nothing is announced for a failed inspection, and the
 * cooldown inside the eligibility check stops repeated inspections from turning
 * into repeated notifications.
 *
 * A scheduling failure must never fail the inspection that just succeeded, so
 * errors here are logged and swallowed.
 */
export async function scheduleDiscoveryIfEligible(document: UrlDocument): Promise<void> {
  try {
    const project = await Project.findById(document.projectId).select('+indexNowKey');

    if (project === null) {
      return;
    }

    const hasKey = typeof project.indexNowKey === 'string' && project.indexNowKey.trim() !== '';

    if (!hasKey) {
      return;
    }

    const verdict = evaluateDiscoveryEligibility(
      {
        status: document.status,
        httpStatus: document.httpStatus ?? null,
        url: document.url,
        indexNowStatus: document.indexNowStatus ?? null,
        indexNowSubmittedAt: document.indexNowSubmittedAt ?? null,
      },
      { domain: project.domain, hasIndexNowKey: true },
    );

    if (!verdict.eligible) {
      console.log(`Discovery not queued: ${verdict.reason}`);
      return;
    }

    const jobId = await addDiscoveryJob({
      projectId: project._id.toString(),
      urlIds: [document._id.toString()],
    });

    console.log(`Discovery job ${jobId} queued for ${redactUrlForLog(document.url)}`);
  } catch (error) {
    console.error(
      `Could not queue discovery: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
