'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BackgroundRunToast } from './BackgroundRunToast';
import { BrandMark } from './BrandMark';
import { Footer } from '@/components/Footer';
import { BugReportModal } from '@/components/BugReportModal';
import { cx } from '@/components/ui/cx';

/**
 * AppShell (FR-36) — the app frame. On internal pages it renders the left
 * Sidebar (a fixed, collapsible rail on desktop; a slide-in drawer on mobile)
 * with the page content + Footer in the column beside it. On public /
 * client-facing pages (login, welcome, docs, status) it renders NO rail — those
 * carry their own chrome — so behaviour there is unchanged.
 *
 * Owns the desktop collapse state (persisted to localStorage) because it also
 * offsets the content column by the rail's width. Replaces the old top Header +
 * AppChrome. Presentational only: every destination, role gate and sign-out is
 * preserved, just relocated to the rail.
 */
const COLLAPSE_KEY = 'fp-sidebar-collapsed';

function isPublic(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/welcome' ||
    pathname === '/docs' ||
    pathname.startsWith('/status/')
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);

  // Restore the remembered collapse state after mount (avoids an SSR mismatch).
  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* private mode / storage disabled — non-fatal */
      }
      return next;
    });

  if (isPublic(pathname)) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* A run keeps going when you leave the tab that started it — say so, once,
          on the way out. Mounted at the shell so it survives route changes. FR-81. */}
      <BackgroundRunToast />

      {/* Desktop rail — fixed to the left edge; width animates on collapse. */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onReportBug={() => setBugOpen(true)}
        className={cx(
          'hidden border-r border-line transition-[width] duration-200 ease-out lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex',
          collapsed ? 'lg:w-16' : 'lg:w-60',
        )}
      />

      {/* Mobile drawer — always full labels, no collapse toggle. */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="fp-menu-in fixed inset-y-0 left-0 z-50 w-64 border-r border-line-strong shadow-2xl shadow-black/60" style={{ transformOrigin: 'left' }}>
            <Sidebar onNavigate={() => setMobileOpen(false)} onReportBug={() => setBugOpen(true)} />
          </div>
        </div>
      )}

      {/* Content column — offset by the rail width on desktop. */}
      <div className={cx('flex min-h-screen flex-col transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
        {/* Mobile top bar — hamburger + brand (the rail is hidden on mobile). */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-ground/80 px-4 py-3 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-panel hover:text-ink"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
              <path d="M3 5.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.5zm0 4.5a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10zm.75 3.75a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <BrandMark size={24} />
            <span className="text-sm font-bold text-ink">FormPing</span>
          </div>
        </div>

        <div className="flex-1">{children}</div>
      </div>

      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
    </div>
  );
}
