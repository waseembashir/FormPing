'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Themed confirmation dialog — replaces the browser `confirm()` popup so every
 * destructive/important action gets a proper, on-brand prompt. Three variants
 * give each CRUD case its own visual language:
 *   danger — destructive (delete): red, irreversible-action warning
 *   info   — additive/neutral confirm: indigo
 *   edit   — a change with side-effects to point out: amber
 *
 * Controlled via `open`; the parent closes it (sets open=false) after the
 * awaited `onConfirm` resolves. Handles Escape + backdrop-dismiss and shows a
 * busy state while confirming. No external dependency.
 */

type Variant = 'danger' | 'info' | 'edit';

interface Props {
  open: boolean;
  variant?: Variant;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const ACCENT: Record<Variant, { chip: string; icon: ReactNode; confirm: string }> = {
  danger: {
    chip: 'bg-red-500/15 text-red-300 ring-red-500/30',
    confirm: 'bg-red-600 hover:bg-red-500 text-white ring-red-400/30',
    icon: (
      <path d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" />
    ),
  },
  info: {
    chip: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
    confirm: 'bg-indigo-600 hover:bg-indigo-500 text-white ring-indigo-400/30',
    icon: (
      <path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2h1v3a1 1 0 002 0v-4a1 1 0 00-1-1H9z" />
    ),
  },
  edit: {
    chip: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    confirm: 'bg-indigo-600 hover:bg-indigo-500 text-white ring-indigo-400/30',
    icon: (
      <path d="M8.257 3.099c.765-1.36 2.72-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" />
    ),
  },
};

export function ConfirmDialog({
  open,
  variant = 'danger',
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  const accent = ACCENT[variant];

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  // Reset busy whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  if (!open) return null;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${accent.chip}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
              {accent.icon}
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            <div className="mt-1 text-xs leading-relaxed text-slate-400">{message}</div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold ring-1 disabled:opacity-60 ${accent.confirm}`}
          >
            {busy ? 'Working…' : (confirmLabel ?? (variant === 'danger' ? 'Delete' : 'Confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}
