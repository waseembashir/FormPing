'use client';

import { useEffect, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * Modal (FR-35) — the generic dialog shell: centered panel, dimmed backdrop,
 * Escape + backdrop dismiss, body-scroll lock. Purely presentational chrome;
 * callers supply the content and their own footer buttons. (ConfirmDialog is the
 * specialised destructive-confirm variant; it will migrate onto this shell.)
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  // `xl` exists for a dialog whose content is a form with a working column —
  // the project form gives most of its width to the URL list, and that list is
  // the only part doing real work. A narrower dialog squeezes it to match three
  // short text inputs beside it.
  const width =
    size === 'sm' ? 'max-w-sm' : size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-md';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cx('fp-menu-in w-full rounded-xl border border-line-strong bg-panel shadow-2xl shadow-black/50', width)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ transformOrigin: 'center' }}
      >
        {(title || subtitle) && (
          <div className="border-b border-line px-5 py-4">
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
