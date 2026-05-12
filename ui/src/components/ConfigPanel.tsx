'use client';
import type { RunConfig, SubmitMode } from '@/types';
import { AiProviderSelect } from './AiProviderSelect';

interface Props {
  config: RunConfig;
  onChange: (c: RunConfig) => void;
  disabled: boolean;
}

const MODES: { value: SubmitMode; label: string; desc: string; color: string }[] = [
  { value: 'safe', label: 'Safe', desc: 'Fill only, no submit', color: 'ring-amber-500 bg-amber-500/10 text-amber-300' },
  { value: 'live', label: 'Live', desc: 'Actually submit', color: 'ring-red-500 bg-red-500/10 text-red-300' },
  { value: 'detect-only', label: 'Detect', desc: 'No form interaction', color: 'ring-slate-500 bg-slate-500/10 text-slate-300' },
];

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{label}</span>
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

export function ConfigPanel({ config, onChange, disabled }: Props) {
  const set = <K extends keyof RunConfig>(key: K, value: RunConfig[K]) =>
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
            {MODES.map(m => (
              <button
                key={m.value}
                onClick={() => !disabled && set('mode', m.value)}
                disabled={disabled}
                className={`rounded-lg px-3 py-2.5 text-center transition-all ring-1 disabled:opacity-40 disabled:cursor-not-allowed ${config.mode === m.value ? m.color : 'ring-slate-700 bg-slate-800 text-slate-400 hover:ring-slate-600 hover:text-slate-300'}`}
              >
                <p className="text-xs font-semibold">{m.label}</p>
                <p className="text-xs opacity-70 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
          {config.mode === 'live' && (
            <p className="mt-2 text-xs text-red-400 flex gap-1.5 items-start">
              <span className="shrink-0">⚠</span>
              Live mode submits real forms. Use only on sites you own or are authorized to test.
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
            Test Email
          </label>
          <input
            type="email"
            value={config.email}
            onChange={e => set('email', e.target.value)}
            disabled={disabled}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 font-mono"
          />
        </div>

        {/* Timeout + Concurrency */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
              Timeout (ms)
            </label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={config.timeout}
              onChange={e => set('timeout', parseInt(e.target.value, 10) || 15000)}
              disabled={disabled}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
              Concurrency
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={config.concurrency}
              onChange={e => set('concurrency', parseInt(e.target.value, 10) || 1)}
              disabled={disabled}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40 font-mono"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3 pt-1">
          <Toggle label="Show browser (headed)" checked={config.headed} onChange={v => set('headed', v)} disabled={disabled} />
          <div>
            <Toggle
              label="Residential IP fallback"
              checked={config.residentialFallback}
              onChange={v => set('residentialFallback', v)}
              disabled={disabled}
            />
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              When a site blocks our cloud IP, retry once through a proxy. Configure one of:
              <br />
              <span className="font-mono text-slate-400">RESIDENTIAL_PROXY_URL</span> (+ <span className="font-mono text-slate-400">_USER</span>/<span className="font-mono text-slate-400">_PASS</span>) for Webshare/IPRoyal/Smartproxy — <span className="text-emerald-500/80">preferred when both set</span>
              <br />
              <span className="font-mono text-slate-400">BROWSERBASE_API_KEY</span> + <span className="font-mono text-slate-400">BROWSERBASE_PROJECT_ID</span> for Browserbase
            </p>
          </div>
        </div>

        {/* AI provider — picks between Claude / Gemini / Groq / Ollama / Off */}
        <AiProviderSelect
          label="AI fallback"
          hint="Used only when contact-page or form scoring is too close to call"
          value={config.aiProvider}
          onChange={(v) => set('aiProvider', v)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
