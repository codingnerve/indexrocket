'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '../components/ui/toast';
import { apiFetch, ApiError, describeError } from './api';
import { useSessionState } from './session';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first response for the current key arrives. */
  loading: boolean;
  /** True while a manual reload is in flight (existing data stays visible). */
  refreshing: boolean;
  reload: () => void;
  mutate: (updater: (current: T) => T) => void;
}

interface ResourceState<T> {
  key: string | null;
  data: T | undefined;
  error: unknown;
  version: number;
}

/**
 * Loads data for a key and keeps it fresh.
 *
 * - `key` identifies the request (usually the API path); `null` pauses loading.
 * - `loader` defaults to `apiFetch(key)`.
 * - `poll(data)` may return a delay in ms to load again, or null to stop. Used
 *   only for real server-side work in progress (queued inspections, running
 *   batches) and it stops as soon as that work settles.
 * - A 401 hands off to the session, which signs the visitor out cleanly.
 */
export function useResource<T>(
  key: string | null,
  loader?: () => Promise<T>,
  options: { poll?: (data: T) => number | null } = {},
): Resource<T> {
  const { reportUnauthorized } = useSessionState();
  const [state, setState] = useState<ResourceState<T>>({ key: null, data: undefined, error: null, version: 0 });
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  const pollRef = useRef(options.poll);

  useEffect(() => {
    loaderRef.current = loader;
    pollRef.current = options.poll;
  });

  useEffect(() => {
    if (key === null) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
      try {
        const load = loaderRef.current ?? (() => apiFetch<T>(key));
        const data = await load();

        if (!active) {
          return;
        }

        setState({ key, data, error: null, version: nonce });

        const delay = pollRef.current?.(data) ?? null;

        if (delay !== null && delay > 0) {
          timer = setTimeout(() => void run(), delay);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError && error.status === 401) {
          reportUnauthorized();
          return;
        }

        setState((current) => ({
          key,
          data: current.key === key ? current.data : undefined,
          error,
          version: nonce,
        }));
      }
    };

    void run();

    return () => {
      active = false;

      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [key, nonce, reportUnauthorized]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const mutate = useCallback((updater: (current: T) => T) => {
    setState((current) => (current.data === undefined ? current : { ...current, data: updater(current.data) }));
  }, []);

  const isCurrent = state.key === key;

  return {
    data: isCurrent ? state.data : undefined,
    error: isCurrent ? state.error : null,
    loading: key !== null && !isCurrent,
    refreshing: isCurrent && state.version !== nonce,
    reload,
    mutate,
  };
}

export interface ActionOptions<R> {
  /** Toast shown on success. */
  success?: string | ((result: R) => string | null);
  successDescription?: string | ((result: R) => string | null);
  /** Toast title shown on failure; the description is the translated error. */
  errorTitle?: string;
  onError?: (error: unknown) => void;
}

/**
 * Runs a mutation with a pending flag, a success toast and a human-readable
 * error toast. Returns the result, or undefined when the action failed.
 */
export function useAction() {
  const toast = useToast();
  const { reportUnauthorized } = useSessionState();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(
    async <R>(key: string, task: () => Promise<R>, options: ActionOptions<R> = {}): Promise<R | undefined> => {
      setPending((current) => new Set(current).add(key));

      try {
        const result = await task();
        const title = typeof options.success === 'function' ? options.success(result) : options.success;
        const description =
          typeof options.successDescription === 'function'
            ? options.successDescription(result)
            : options.successDescription;

        if (title !== undefined && title !== null) {
          toast.success(title, description ?? undefined);
        }

        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          reportUnauthorized();
          return undefined;
        }

        toast.error(options.errorTitle ?? 'Action failed', describeError(error));
        options.onError?.(error);

        return undefined;
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);

          return next;
        });
      }
    },
    [toast, reportUnauthorized],
  );

  const isPending = useCallback((key: string) => pending.has(key), [pending]);

  return { run, isPending, anyPending: pending.size > 0 };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
