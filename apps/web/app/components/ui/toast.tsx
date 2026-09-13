'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION: Record<ToastTone, number> = { success: 4000, info: 5000, error: 7000 };

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;

const ICON_TONE: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-info',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = ICONS[toast.tone];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DURATION[toast.tone]);

    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3.5 shadow-lg animate-slide-up"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[toast.tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{toast.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 rounded-sm p-1 text-muted transition-colors hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Lightweight toast system: no dependency, announced to assistive technology. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, title: string, description?: string) => {
    const id = nextId.current++;

    setToasts((current) => [
      ...current.slice(-3),
      description === undefined ? { id, tone, title } : { id, tone, title, description },
    ]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push('success', title, description),
      error: (title, description) => push('error', title, description),
      info: (title, description) => push('info', title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);

  if (value === null) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }

  return value;
}
