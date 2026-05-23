'use client';
import type { MonitorConfig, MonitorMode } from '@/types';
import { AiProviderSelect } from '../AiProviderSelect';

interface Props {
  config: MonitorConfig;
  onChange: (c: MonitorConfig) => void;
  disabled: boolean;
}

const MODES: { value: MonitorMode; label: string; desc: string; color: string }[] = [
  { value: 'snapshot', label: 'Snapshot', desc: 'Save baseline',  color: 'ring-emerald-500 bg-emerald-500/10 text-emerald-300' },
  { value: 'compare',  label: 'Compare',  desc: 'Diff vs latest', color: 'ring-indigo-500 bg-indigo-500/10 text-indigo-300' },
  { value: 'watch',    label: 'Watch',    desc: 'Loop on schedule', color: 'ring-amber-500 bg-amber-500/10 text-amber-300' },
];

function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean; hint?: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div>
        <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors block">{label}</span>
        {hint && <span className="text-xs text-slate-500 block">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-slate-700'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

export function MonitorConfigPanel({ config, onChange, disabled }: Props) {
  const set = <K extends keyof MonitorConfig>(key: K, value: MonitorConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">Configuration</h2>
      </div>

      <div className="p-4 space-y-5">
        {/* Mode selector */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => !disabled && set('monitorMode', m.value)}
                disabled={disabled}
                className={`rounded-lg px-3 py-2.5 text-center transition-all ring-1 disabled:opacity-40 disabled:cursor-not-allowed ${
                  config.monitorMode === m.value
                    ? m.color
                    : 'ring-slate-700 bg-slate-800 text-slate-400 hover:ring-slate-600 hover:text-slate-300'
                }`}
              >
                <p className="text-xs font-semibold">{m.label}</p>
                <p className="text-xs opacity-70 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
          {config.monitorMode === 'watch' && (
            <p className="mt-2 text-xs text-amber-400 flex gap-1.5 items-start">
              <span className="shrink-0">⏱</span>
              Watch runs the comparison continuously until you stop it.
            </p>
          )}
        </div>

        {/* Max pages */}
        <div>
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
            Max pages to crawl
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={config.maxPages}
            onChange={(e) => set('maxPages', parseInt(e.target.value, 10) || 10)}
            disabled={disabled}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 font-mono"
          />
        </div>

        {/* Watch interval (only shown when in watch mode) */}
        {config.monitorMode === 'watch' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
              Watch interval (seconds)
            </label>
            <input
              type="number"
              min={10}
              step={60}
              value={Math.round(config.watchIntervalMs / 1000)}
              onChange={(e) => set('watchIntervalMs', Math.max(10, parseInt(e.target.value, 10) || 60) * 1000)}
              disabled={disabled}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 font-mono"
            />
            <p className="text-xs text-slate-500 mt-1">Default: 3600s (1 hour)</p>
          </div>
        )}

        {/* Toggles */}
        <div className="space-y-3 pt-1">
          <Toggle
            label="Capture screenshots"
            hint="Uses Playwright — slower"
            checked={config.takeScreenshots}
            onChange={(v) => set('takeScreenshots', v)}
            disabled={disabled}
          />
        </div>

        {/* AI provider for the change-summary call */}
        <AiProviderSelect
          label="AI summary"
          hint="Turn the diff into a readable paragraph"
          value={config.aiProvider}
          onChange={(v) => set('aiProvider', v)}
          disabled={disabled}
        />

        {/* Slack notifications — env-var driven, just an info block */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
            <span aria-hidden>💬</span> Slack notifications
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Set the{' '}
            <span className="font-mono text-slate-400">SLACK_WEBHOOK_URL</span>{' '}
            env var to your{' '}
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline decoration-dotted underline-offset-2"
            >
              Slack Incoming Webhook
            </a>{' '}
            to get a message in your channel whenever changes are detected
            (both watch mode and one-off compare runs).
          </p>
        </div>
      </div>
    </div>
  );
}
