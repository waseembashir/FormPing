'use client';
import { useState } from 'react';
import type { SiteResult } from '@/types';
import { StatusBadge, ReasonCodeBadge } from './StatusBadge';
import { ConfidenceBar } from './ConfidenceBar';
import { getReasonMessage, type Severity } from '@/lib/reasonMessages';

const BANNER_STYLES: Record<Severity, { wrap: string; icon: string; title: string }> = {
  success: { wrap: 'bg-emerald-500/10 border-emerald-500/20', icon: '✓', title: 'text-emerald-300' },
  info:    { wrap: 'bg-slate-500/10 border-slate-500/20',     icon: 'ℹ', title: 'text-slate-300' },
  warn:    { wrap: 'bg-amber-500/10 border-amber-500/20',     icon: '⚠', title: 'text-amber-300' },
  error:   { wrap: 'bg-red-500/10 border-red-500/20',         icon: '✕', title: 'text-red-300' },
};

function FieldRow({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-500 w-32 shrink-0">{label}</span>
      <span className={`text-slate-300 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function CheckIcon({ ok }: { ok: boolean }) {
  return ok
    ? <span className="text-emerald-400 text-xs">✓</span>
    : <span className="text-slate-600 text-xs">✗</span>;
}

function Pill({ label, active, color }: { label: string; active: boolean; color: string }) {
  if (!active) return null;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ResultCard({ result }: { result: SiteResult }) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const domain = getDomain(result.normalizedUrl);

  const statusBorder: Record<string, string> = {
    pass: 'border-emerald-500/20',
    fail: 'border-red-500/20',
    warn: 'border-amber-500/20',
    error: 'border-slate-500/20',
  };
  const border = statusBorder[result.finalStatus] ?? 'border-slate-700';

  const reason = getReasonMessage(result.reasonCode);
  const banner = BANNER_STYLES[reason.severity];
  const hasErrors = result.errors && result.errors.length > 0;

  return (
    <div className={`rounded-xl border ${border} bg-slate-900 overflow-hidden animate-slide-in`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Favicon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            alt=""
            width={16}
            height={16}
            className="rounded shrink-0 opacity-70"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium text-slate-100 truncate">{domain}</p>
            <p className="font-mono text-xs text-slate-500 truncate">{result.normalizedUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 font-mono">{formatMs(result.durationMs)}</span>
          <StatusBadge status={result.finalStatus} />
        </div>
      </div>

      {/* Reason banner */}
      <div className={`mx-4 mb-3 rounded-lg border px-3 py-2.5 flex gap-2.5 items-start ${banner.wrap}`}>
        <span className={`${banner.title} text-sm font-bold leading-5 shrink-0 mt-0.5`}>{banner.icon}</span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${banner.title}`}>{reason.title}</p>
          {reason.description && (
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{reason.description}</p>
          )}
        </div>
      </div>

      {/* Errors list (field-level failures) */}
      {hasErrors && (
        <div className="mx-4 mb-3 rounded-lg border border-red-500/20 bg-red-500/5">
          <div className="px-3 py-2 border-b border-red-500/20 flex items-center gap-2">
            <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">
              {result.errors.length} field error{result.errors.length !== 1 ? 's' : ''}
            </span>
          </div>
          <ul className="px-3 py-2 space-y-1">
            {result.errors.slice(0, 8).map((err, i) => (
              <li key={i} className="text-xs font-mono text-red-200/80 break-all">
                <span className="text-red-400/60 mr-1">·</span>{err}
              </li>
            ))}
            {result.errors.length > 8 && (
              <li className="text-xs text-slate-500 italic">+{result.errors.length - 8} more…</li>
            )}
          </ul>
        </div>
      )}

      {/* Quick status row */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
        <ReasonCodeBadge code={result.reasonCode} />
        <Pill label="CAPTCHA" active={result.captchaDetected} color="bg-orange-500/15 text-orange-400" />
        <Pill label="Anti-Bot" active={result.antiBotDetected} color="bg-red-500/15 text-red-400" />
        <Pill label="Thank-You ✓" active={result.thankYouDetected} color="bg-emerald-500/15 text-emerald-400" />
        <Pill label="Inline Success ✓" active={result.inlineSuccessDetected} color="bg-emerald-500/15 text-emerald-400" />
      </div>

      {/* Detection summary */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <CheckIcon ok={result.contactPageFound} />
          <span>Contact page</span>
          {result.contactPageFound && (
            <span className="font-mono text-slate-500 truncate max-w-[120px]">
              {result.resolvedContactPage ? new URL(result.resolvedContactPage).pathname : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <CheckIcon ok={result.formFound} />
          <span>Form detected</span>
          {result.formIdentifier?.id && (
            <span className="font-mono text-slate-500">#{result.formIdentifier.id}</span>
          )}
        </div>
      </div>

      {/* Confidence bars */}
      {(result.contactPageFound || result.formFound) && (
        <div className="px-4 pb-3 space-y-1.5">
          {result.contactPageFound && (
            <ConfidenceBar value={result.contactPageConfidence} label="Contact page" />
          )}
          {result.formFound && (
            <ConfidenceBar value={result.formConfidence} label="Form detection" />
          )}
        </div>
      )}

      {/* Expand/collapse footer */}
      <div className="flex items-center border-t border-slate-800 divide-x divide-slate-800">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 px-4 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors text-left"
        >
          {result.notes.length > 0
            ? `${expanded ? '▲ Hide' : '▼ Show'} ${result.notes.length} note${result.notes.length !== 1 ? 's' : ''}`
            : (expanded ? '▲ Hide details' : '▼ Show details')}
        </button>
        <button
          onClick={() => setShowJson(!showJson)}
          className="px-4 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/50 transition-colors font-mono"
        >
          {showJson ? '{ hide }' : '{ JSON }'}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}
          className="px-4 py-2 text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          title="Copy JSON"
        >
          ⎘ Copy
        </button>
      </div>

      {/* Expanded notes + details */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-800 space-y-3 animate-fade-in">
          {result.notes.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Notes</p>
              <ul className="space-y-1">
                {result.notes.map((note, i) => (
                  <li key={i} className="text-xs text-slate-300 flex gap-2">
                    <span className="text-slate-600 shrink-0">·</span>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Details</p>
            <FieldRow label="Mode" value={result.mode} />
            <FieldRow label="Contact page" value={result.resolvedContactPage} mono />
            <FieldRow label="Final URL" value={result.finalUrl} mono />
            <FieldRow label="Redirect URL" value={result.redirectUrl} mono />
            <FieldRow label="Submission" value={result.submissionResult} />
            {result.formIdentifier && (
              <>
                <FieldRow label="Form ID" value={result.formIdentifier.id} mono />
                <FieldRow label="Form action" value={result.formIdentifier.action} mono />
                <FieldRow label="Form method" value={result.formIdentifier.method} mono />
              </>
            )}
            {result.error && (
              <FieldRow label="Error" value={result.error} />
            )}
          </div>
        </div>
      )}

      {/* Raw JSON */}
      {showJson && (
        <div className="border-t border-slate-800 animate-fade-in">
          <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
