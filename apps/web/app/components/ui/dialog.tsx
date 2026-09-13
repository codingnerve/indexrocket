'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button, IconButton } from './button';

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * Modal dialog on the native <dialog> element: focus is moved in and trapped,
 * Escape closes it, and the rest of the page is inert while it is open.
 * Content is only mounted while open, so forms always start fresh.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;

    if (dialog === null) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
      onCancel={(event) => {
        if (!dismissible) {
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) {
          onClose();
        }
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-visible rounded-xl border border-border bg-card p-0 shadow-lg',
        SIZES[size],
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-[13px] leading-5 text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? <IconButton icon={X} label="Close dialog" onClick={onClose} className="-mt-1 -mr-2" /> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-subtle/50 px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Side sheet for mobile navigation, on the same native <dialog> mechanics. */
export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;

    if (dialog === null) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-variant="drawer"
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose();
        }
      }}
      className="m-0 h-dvh max-h-none w-[288px] max-w-[85vw] border-r border-border bg-sidebar p-0 shadow-lg"
    >
      {open ? children : null}
    </dialog>
  );
}
