/**
 * Ordered, time-boxed shutdown shared by the API and the worker.
 *
 * Steps run strictly in order (stop intake -> drain work -> close queues ->
 * close Redis -> close MongoDB). A failing step is recorded and the remaining
 * steps still run, so one stuck resource never prevents the others from being
 * released. The whole sequence is bounded by a timeout so a deploy can never
 * hang forever waiting on a process that will not exit.
 */
export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown> | unknown;
}

export interface ShutdownResult {
  /** True when every step finished without error inside the timeout. */
  ok: boolean;
  timedOut: boolean;
  completed: string[];
  failed: string[];
}

export interface ShutdownOptions {
  timeoutMs: number;
  log?: (message: string) => void;
}

export async function runShutdown(steps: ShutdownStep[], options: ShutdownOptions): Promise<ShutdownResult> {
  const completed: string[] = [];
  const failed: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sequence = (async () => {
    for (const step of steps) {
      try {
        await step.run();
        completed.push(step.name);
        options.log?.(`shutdown: ${step.name} done`);
      } catch (error) {
        failed.push(step.name);
        options.log?.(
          `shutdown: ${step.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return 'done' as const;
  })();

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.timeoutMs);
  });

  const outcome = await Promise.race([sequence, timeout]);

  if (timer !== undefined) {
    clearTimeout(timer);
  }

  return {
    ok: outcome === 'done' && failed.length === 0,
    timedOut: outcome === 'timeout',
    completed,
    failed,
  };
}
