'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

interface Profile {
  user: string;
  name: string | null;
  picture: string | null;
}

interface SubTab {
  href: string;
  label: string;
}
interface NavGroup {
  label: string;
  /** Where the top-level tab links to (the group's primary page). */
  href: string;
  /** Pathnames that belong to this group (drives active state). */
  match: string[];
  subTabs: SubTab[];
  /** Shown in the sub-nav row for areas with no sub-tabs, so the header keeps a
   *  constant height (prevents the page shifting when navigating to/from Docs). */
  hint?: string;
}

// Two subject-based areas + Docs. The on-demand and scheduled views of the
// same subject live together so the app reads as "the client's form" vs
// "the client's site" rather than five unrelated tabs.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Forms',
    href: '/',
    match: ['/', '/form-watch'],
    subTabs: [
      { href: '/', label: 'Test a form' },
      { href: '/form-watch', label: 'Scheduled monitors' },
    ],
  },
  {
    label: 'Site',
    href: '/site-watch',
    match: ['/site-watch', '/monitor'],
    subTabs: [
      { href: '/site-watch', label: 'Uptime & SSL' },
      { href: '/monitor', label: 'Change tracking' },
    ],
  },
  {
    label: 'Docs',
    href: '/docs',
    match: ['/docs'],
    subTabs: [],
    hint: 'Reference & how-tos',
  },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const activeGroup = NAV_GROUPS.find((g) => g.match.includes(pathname));
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
      <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:gap-6">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          {/* Brand mark — Form + Ping (same artwork as the favicon) */}
          <div className="rounded-lg shadow-lg shadow-indigo-900/50">
            <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden className="block">
              <defs>
                <linearGradient id="fpHeaderMark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#4338ca" />
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="14" fill="url(#fpHeaderMark)" />
              <rect x="14" y="12" width="27" height="29" rx="5" fill="#ffffff" />
              <rect x="19" y="18.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
              <rect x="19" y="24.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
              <rect x="19" y="30.4" width="11" height="3.2" rx="1.6" fill="#c7d2fe" />
              <circle cx="45" cy="46" r="8" fill="none" stroke="#ff6a2b" strokeWidth="2.4" opacity="0.5" />
              <circle cx="45" cy="46" r="4.2" fill="#ff6a2b" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-none">FormPing</h1>
            <p className="hidden sm:block text-xs text-slate-500 mt-0.5">Contact Form QA & Site Monitor</p>
          </div>
        </div>

        {/* Top-level nav — a segmented control grouped by subject (Forms / Site / Docs).
            On mobile it drops to its own full-width row below the brand/sign-out, with
            the pills sharing the width evenly. */}
        <nav className="order-last w-full sm:order-none sm:w-auto flex items-center gap-1 bg-slate-900/70 rounded-xl p-1 ring-1 ring-slate-800 shadow-inner shadow-black/20">
          {NAV_GROUPS.map((group) => {
            const active = group.match.includes(pathname);
            return (
              <Link
                key={group.href}
                href={group.href}
                className={`flex-1 sm:flex-initial text-center px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  active
                    ? 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-900/50 ring-1 ring-indigo-400/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                {group.label}
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

      {/* Sub-nav — ALWAYS rendered so the header height stays constant. This stops
          the page shifting when navigating to/from an area without sub-tabs (Docs).
          Areas with sub-tabs show underline tabs (the indicator scales in on the
          active one); others show a muted hint. Keyed on the area so the row fades
          in on an area switch (mobile only). */}
      <div className="border-t border-slate-800/60">
        <div
          key={activeGroup?.label ?? 'none'}
          className="fp-subnav-in max-w-7xl mx-auto px-4 flex items-stretch gap-1 sm:gap-2 h-11 overflow-x-auto"
        >
          {activeGroup && activeGroup.subTabs.length > 0 ? (
            activeGroup.subTabs.map((sub) => {
              const subActive = pathname === sub.href;
              return (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={`group relative flex-1 sm:flex-initial inline-flex items-center justify-center px-3 text-xs font-medium whitespace-nowrap transition-colors duration-200 ${
                    subActive ? 'text-indigo-300' : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  {sub.label}
                  <span
                    className={`pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full origin-center transition-transform duration-300 ease-out ${
                      subActive
                        ? 'bg-indigo-400 scale-x-100'
                        : 'bg-slate-600 scale-x-0 group-hover:scale-x-50'
                    }`}
                  />
                </Link>
              );
            })
          ) : (
            <span className="inline-flex items-center text-xs font-medium text-slate-600">
              {activeGroup?.hint ?? ''}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
