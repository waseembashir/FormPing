'use client';

import { useEffect, useState } from 'react';
import type { AiProviderSelection, AiProvidersResponse, AiProviderInfo } from '@/types';

interface Props {
  /** Visible label e.g. "AI summary" or "AI fallback" */
  label: string;
  /** Short description shown under the label */
  hint?: string;
  value: AiProviderSelection;
  onChange: (next: AiProviderSelection) => void;
  disabled?: boolean;
}

const AUTO_LABEL = (fallbackLabel?: string) =>
  fallbackLabel ? `Auto (uses ${fallbackLabel})` : 'Auto detect';

export function AiProviderSelect({ label, hint, value, onChange, disabled }: Props) {
  const [data, setData] = useState<AiProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/ai/providers')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: AiProvidersResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData({ providers: [], fallback: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fallbackProvider: AiProviderInfo | undefined =
    data?.providers.find((p) => p.id === data.fallback);
  const anyAvailable = data?.providers.some((p) => p.available) ?? false;

  // What to display in the trigger button
  const triggerLabel = (() => {
    if (value === 'off') return 'Off';
    if (value === 'auto') {
      return fallbackProvider ? AUTO_LABEL(fallbackProvider.modelLabel) : 'Auto detect';
    }
    const found = data?.providers.find((p) => p.id === value);
    return found?.modelLabel ?? value;
  })();

  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-500 mb-1.5 -mt-1">{hint}</p>}

      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setOpen((v) => !v)}
          disabled={disabled}
          className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed ${
            value === 'off' ? 'text-slate-400' : 'text-slate-100'
          }`}
        >
          <span className="truncate flex items-center gap-2">
            {value !== 'off' && (
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"
                aria-hidden
              />
            )}
            {loading ? 'Loading…' : triggerLabel}
          </span>
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && data && (
          <div
            className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 overflow-hidden"
          >
            <ul className="max-h-72 overflow-y-auto py-1">
              {/* Off */}
              <Option
                selected={value === 'off'}
                label="Off"
                hint="No AI — deterministic only"
                onClick={() => {
                  onChange('off');
                  setOpen(false);
                }}
              />

              {/* Auto */}
              <Option
                selected={value === 'auto'}
                label={AUTO_LABEL(fallbackProvider?.modelLabel)}
                hint={
                  fallbackProvider
                    ? 'Uses first available provider'
                    : 'No provider configured — will fall back to off'
                }
                disabled={!anyAvailable}
                onClick={() => {
                  if (!anyAvailable) return;
                  onChange('auto');
                  setOpen(false);
                }}
              />

              <li className="my-1 mx-2 border-t border-slate-800" aria-hidden />

              {/* Each provider */}
              {data.providers.map((p) => (
                <Option
                  key={p.id}
                  selected={value === p.id}
                  label={p.modelLabel}
                  hint={
                    p.available
                      ? p.label
                      : p.configured
                        ? `${p.label} · not reachable`
                        : `${p.label} · not configured`
                  }
                  disabled={!p.available}
                  onClick={() => {
                    if (!p.available) return;
                    onChange(p.id);
                    setOpen(false);
                  }}
                  setupHint={p.available ? undefined : p.setupHint}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Click-outside backdrop */}
        {open && (
          <button
            type="button"
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
        )}
      </div>
    </div>
  );
}

function Option({
  selected,
  label,
  hint,
  disabled,
  onClick,
  setupHint,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
  setupHint?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : selected
              ? 'bg-indigo-600/10 text-indigo-200 hover:bg-indigo-600/20'
              : 'text-slate-200 hover:bg-slate-800'
        }`}
      >
        <span className="mt-0.5 shrink-0">
          {selected ? (
            <span className="inline-block w-3.5 h-3.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/30" />
          ) : disabled ? (
            <span className="inline-block w-3.5 h-3.5 rounded-full border border-slate-700" />
          ) : (
            <span className="inline-block w-3.5 h-3.5 rounded-full border border-slate-600" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{label}</p>
          {hint && <p className="text-xs text-slate-500 mt-0.5 truncate">{hint}</p>}
          {setupHint && (
            <p className="text-xs text-slate-600 mt-1 font-mono break-words">{setupHint}</p>
          )}
        </div>
      </button>
    </li>
  );
}
