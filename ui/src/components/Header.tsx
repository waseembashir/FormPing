'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface Profile {
  user: string;
  name: string | null;
  picture: string | null;
}

const TABS = [
  { href: '/', label: 'Form Tester' },
  { href: '/monitor', label: 'Change Monitor' },
  { href: '/docs', label: 'Docs' },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [profile, setProfile] = useState<Profile | null>(null);

  // Load the signed-in user's profile (name + avatar) for the header chip.
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (active && d && d.user) setProfile(d as Profile);
      })
      .catch(() => {
        /* not signed in or auth disabled — show nothing */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  };

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
          {profile && (
            <div className="hidden sm:inline-flex items-center gap-2 bg-slate-800/60 pl-1 pr-3 py-1 rounded-full ring-1 ring-slate-700">
              {profile.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-semibold text-white">
                  {(profile.name || profile.user).charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-xs font-medium text-slate-200 max-w-[140px] truncate">
                {profile.name || profile.user}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={pending}
            title="Sign out"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 px-2.5 py-1.5 rounded-md transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-3.5 h-3.5"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z"
                clipRule="evenodd"
              />
              <path
                fillRule="evenodd"
                d="M19 10a.75.75 0 00-.22-.53l-3.25-3.25a.75.75 0 00-1.06 1.06L16.94 9.5H9.75a.75.75 0 000 1.5h7.19l-2.47 2.47a.75.75 0 101.06 1.06l3.25-3.25c.141-.141.22-.331.22-.53z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">{pending ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
