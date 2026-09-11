/** Payload for one batch item job on the submission queue. */
export interface SubmissionJobData {
  batchId: string;
  itemId: string;
  projectId: string;
  userId: string;
  urlId: string;
  url: string;
  /** Mirrors the batch option so the worker needs no extra read to decide. */
  inspectGoogle: boolean;
  googleSiteUrl: string | null;
}

export interface SubmissionJobResult {
  itemId: string;
  status: 'completed' | 'failed' | 'skipped';
  inspection: string;
  discovery: string;
  google: string;
}
