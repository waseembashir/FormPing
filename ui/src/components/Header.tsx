'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Form Tester' },
  { href: '/monitor', label: 'Change Monitor' },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-900/50">
            FP
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-none">FormPing</h1>
            <p className="text-xs text-slate-500 mt-0.5">Contact Form QA & Site Monitor</p>
          </div>
        </div>

        {/* Tab nav */}
        <nav className="flex items-center gap-1 bg-slate-900/60 rounded-lg p-1 ring-1 ring-slate-800">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white shadow shadow-indigo-900/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-800/60 px-3 py-1.5 rounded-full ring-1 ring-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Authorized testing only
          </span>
        </div>
      </div>
    </header>
  );
}
