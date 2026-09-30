'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { forgetTab } from '@/lib/tabCache';
import { usePathname, useRouter } from 'next/navigation';
import { useMe, canRole } from '@/lib/auth/useMe';
import { ROLE_LABEL } from '@/lib/auth/roles';
import { cx } from '@/components/ui/cx';
import { BrandMark } from './BrandMark';

/**
 * Sidebar (FR-36) — the app's primary navigation rail. Replaces the old top
 * Header: grouped nav down the left, brand at the top, signed-in profile pinned
 * to the bottom (account menu → Team & access, Sign out).
 *
 * Collapsible (HubSpot-style): expanded shows icons + labels + sub-items; collapsed
 * shrinks to a narrow icon-only strip where each area icon reveals a hover flyout
 * with its label and sub-links, so you always know what an icon means. The
 * collapsed state is owned by AppShell (it also offsets the page) and persisted.
 *
 * Same destinations and roles as before — nothing removed, just relocated and
 * made collapsible. `onNavigate` lets the mobile drawer close on a link tap.
 */

interface Leaf {
  href: string;
  label: string;
}
interface NavGroup {
  label: string;
  icon: ReactNode;
  /** Standalone destination (no children). */
  href?: string;
  /** Active when the path starts with this (covers detail sub-routes). */
  matchPrefix?: string;
  children?: Leaf[];
}

const ICON = {
  projects: (
    <path d="M3 5.5A1.5 1.5 0 014.5 4h3.8a1.5 1.5 0 011.06.44l1.2 1.2h4.94A1.5 1.5 0 0117 7.14V14.5A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-9z" />
  ),
  forms: (
    <path d="M6 2.5A1.5 1.5 0 004.5 4v12A1.5 1.5 0 006 17.5h8a1.5 1.5 0 001.5-1.5V6.62a1.5 1.5 0 00-.44-1.06l-2.62-2.62A1.5 1.5 0 0011.38 2.5H6zM7 8h6v1.4H7V8zm0 3h6v1.4H7V11z" />
  ),
  site: (
    <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM3.5 10a6.5 6.5 0 0112.06-3.4l-1.7 1.02a1 1 0 00-.46.7l-.28 1.68-1.5.6a1 1 0 00-.62.93v1.02l-1.3.86a1 1 0 00-.44.83v1.6A6.5 6.5 0 013.5 10z" />
  ),
  docs: (
    <path d="M2.5 5A1.5 1.5 0 014 3.5c1.66 0 3.16.5 4.25 1.32V16c-1.09-.82-2.59-1.32-4.25-1.32A1.5 1.5 0 012.5 13.2V5zm15 0a1.5 1.5 0 00-1.5-1.5c-1.66 0-3.16.5-4.25 1.32V16c1.09-.82 2.59-1.32 4.25-1.32a1.5 1.5 0 001.5-1.48V5z" />
  ),
  whatsNew: (
    <path d="M9 2.2l1.5 3.9a1 1 0 00.6.6L15 8.2l-3.9 1.5a1 1 0 00-.6.6L9 14.2l-1.5-3.9a1 1 0 00-.6-.6L3 8.2l3.9-1.5a1 1 0 00.6-.6L9 2.2zM15.5 12l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" />
  ),
  bug: (
    <path d="M10 2.75a2.25 2.25 0 012.24 2.06 6.5 6.5 0 011.3.74l1.24-.72a.75.75 0 11.76 1.3l-1.1.63c.2.42.35.87.42 1.34H16a.75.75 0 010 1.5h-1.03a6.5 6.5 0 01-.42 2l1.1.64a.75.75 0 11-.76 1.3l-1.24-.72A5.5 5.5 0 0110.75 16.4V10a.75.75 0 00-1.5 0v6.4a5.5 5.5 0 01-2.9-1.98l-1.24.72a.75.75 0 11-.76-1.3l1.1-.64a6.5 6.5 0 01-.42-2H4a.75.75 0 010-1.5h1.02c.07-.47.22-.92.42-1.34l-1.1-.63a.75.75 0 11.76-1.3l1.24.72a6.5 6.5 0 011.3-.74A2.25 2.25 0 0110 2.75z" />
  ),
  team: (
    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.357-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.907 3.96 2.32 2.32 0 01-.026.654zM18 8a2 2 0 11-4 0 2 2 0 014 0zM5.304 16.19a.844.844 0 01-.277-.71 5 5 0 019.947 0 .843.843 0 01-.277.71A6.975 6.975 0 0110 18a6.974 6.974 0 01-4.696-1.81z" />
  ),
};

const NAV: NavGroup[] = [
  { label: 'Projects', href: '/projects', matchPrefix: '/projects', icon: ICON.projects },
  {
    label: 'Contact Forms',
    icon: ICON.forms,
    children: [
      { href: '/', label: 'Form Tester' },
      { href: '/form-watch', label: 'Form Scheduler' },
    ],
  },
  {
    label: 'Site Health',
    icon: ICON.site,
    children: [
      { href: '/site-watch', label: 'Uptime & SSL' },
      { href: '/monitor', label: 'Content Changes' },
    ],
  },
];

function isActive(pathname: string, href: string, prefix?: string): boolean {
  if (prefix) return pathname === prefix || pathname.startsWith(`${prefix}/`);
  return pathname === href;
}
function groupActive(pathname: string, g: NavGroup): boolean {
  if (g.href) return isActive(pathname, g.href, g.matchPrefix);
  return Boolean(g.children?.some((c) => isActive(pathname, c.href)));
}

// ── Expanded nav link ─────────────────────────────────────────────────────────
function NavLink({
  href,
  icon,
  children,
  active,
  indent,
  onNavigate,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  active: boolean;
  indent?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex items-center gap-2.5 rounded-lg transition-colors',
        indent ? 'py-1.5 pl-9 pr-3 text-[12.5px] font-medium' : 'px-3 py-2 text-sm font-medium',
        active ? 'bg-accent/15 text-accent-soft' : 'text-ink-muted hover:bg-panel hover:text-ink',
      )}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}
      {icon && (
        <svg viewBox="0 0 20 20" fill="currentColor" className={cx('h-[18px] w-[18px] shrink-0', active ? 'text-accent-soft' : 'text-ink-faint group-hover:text-ink-muted')} aria-hidden>
          {icon}
        </svg>
      )}
      <span className="truncate">{children}</span>
    </Link>
  );
}

// ── Collapsed area icon + hover flyout ────────────────────────────────────────
function CollapsedArea({ group, pathname, onNavigate }: { group: NavGroup; pathname: string; onNavigate?: () => void }) {
  const href = group.href ?? group.children![0]!.href;
  const active = groupActive(pathname, group);
  return (
    <div className="group relative flex justify-center">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={group.label}
        className={cx(
          'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
          active ? 'bg-accent/15 text-accent-soft' : 'text-ink-faint hover:bg-panel hover:text-ink',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-[19px] w-[19px]" aria-hidden>
          {group.icon}
        </svg>
      </Link>
      {/* Flyout — pl-2 (not margin) so there's no dead gap that would drop the hover. */}
      <div className="absolute left-full top-0 z-50 hidden pl-2 group-hover:block">
        <div className="min-w-[168px] rounded-lg border border-line-strong bg-panel-raised p-1 shadow-2xl shadow-black/50">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold text-ink">{group.label}</div>
          {group.children?.map((leaf) => (
            <Link
              key={leaf.href}
              href={leaf.href}
              onClick={onNavigate}
              className={cx(
                'block rounded-md px-2.5 py-1.5 text-xs font-medium',
                isActive(pathname, leaf.href) ? 'bg-accent/15 text-accent-soft' : 'text-ink-muted hover:bg-panel hover:text-ink',
              )}
            >
              {leaf.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Profile block (bottom) ────────────────────────────────────────────────────
function ProfileBlock({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const name = me.name || me.email || '';

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me.email) return null;

  const logout = async () => {
    setOpen(false);
    // Drop every remembered tab payload before the session ends. The cache
    // lives for the life of the page, and the page survives a sign-out — so
    // without this the next person at this browser could see the previous
    // one's projects for the frame before the refresh lands. FR-105.
    forgetTab();
    await fetch('/api/auth/logout', { method: 'POST' });
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  };

  const avatar = me.picture ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-strong text-xs font-semibold text-white">
      {name.charAt(0).toUpperCase()}
    </span>
  );

  const menu = open && (
    <div
      role="menu"
      className={cx(
        'fp-menu-in absolute z-50 overflow-hidden rounded-xl border border-line-strong bg-panel-raised shadow-2xl shadow-black/50',
        collapsed ? 'bottom-1 left-full ml-2 w-52' : 'bottom-full left-3 right-3 mb-2',
      )}
    >
      <button type="button" onClick={logout} disabled={pending} role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-ink-secondary hover:bg-panel disabled:opacity-40">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-ink-faint" aria-hidden><path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" /><path fillRule="evenodd" d="M19 10a.75.75 0 00-.22-.53l-3.25-3.25a.75.75 0 00-1.06 1.06L16.94 9.5H9.75a.75.75 0 000 1.5h7.19l-2.47 2.47a.75.75 0 101.06 1.06l3.25-3.25c.141-.141.22-.331.22-.53z" clipRule="evenodd" /></svg>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );

  if (collapsed) {
    return (
      <div className="relative flex justify-center border-t border-line p-3" ref={ref}>
        {menu}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={me.name || me.email || 'Account'} className={cx('rounded-full ring-1 transition-colors', open ? 'ring-line-strong' : 'ring-transparent hover:ring-line-strong')}>
          {avatar}
        </button>
      </div>
    );
  }

  return (
    <div className="relative border-t border-line p-3" ref={ref}>
      {menu}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={cx('flex w-full items-center gap-2.5 rounded-lg p-2 text-left ring-1 transition-colors', open ? 'bg-panel ring-line-strong' : 'ring-transparent hover:bg-panel')}>
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{me.name || 'Signed in'}</span>
          <span className="block truncate text-[11px] text-ink-faint">{me.email}</span>
        </span>
        {me.role && (
          <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-[3px] text-[9px] font-bold uppercase leading-none tracking-wide text-accent-soft ring-1 ring-accent/25">
            {ROLE_LABEL[me.role]}
          </span>
        )}
      </button>
    </div>
  );
}

// ── Utility item (Docs / Report a bug) — link OR button, both nav modes ───────
function UtilityItem({
  icon,
  label,
  href,
  onClick,
  active,
  collapsed,
  onNavigate,
}: {
  icon: ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const activate = () => {
    onClick?.();
    onNavigate?.();
  };

  if (collapsed) {
    const inner = (
      <span className={cx('flex h-10 w-10 items-center justify-center rounded-lg transition-colors', active ? 'bg-accent/15 text-accent-soft' : 'text-ink-faint hover:bg-panel hover:text-ink')}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-[19px] w-[19px]" aria-hidden>{icon}</svg>
      </span>
    );
    return (
      <div className="group relative flex justify-center">
        {href ? (
          <Link href={href} onClick={onNavigate} aria-label={label}>{inner}</Link>
        ) : (
          <button type="button" onClick={activate} aria-label={label}>{inner}</button>
        )}
        <div className="absolute left-full top-0 z-50 hidden pl-2 group-hover:block">
          <div className="whitespace-nowrap rounded-lg border border-line-strong bg-panel-raised px-2.5 py-1.5 text-[11px] font-semibold text-ink shadow-2xl shadow-black/50">{label}</div>
        </div>
      </div>
    );
  }

  const cls = cx('group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors', active ? 'bg-accent/15 text-accent-soft' : 'text-ink-muted hover:bg-panel hover:text-ink');
  const inner = (
    <>
      <svg viewBox="0 0 20 20" fill="currentColor" className={cx('h-[18px] w-[18px] shrink-0', active ? 'text-accent-soft' : 'text-ink-faint group-hover:text-ink-muted')} aria-hidden>{icon}</svg>
      <span className="truncate">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} onClick={onNavigate} className={cls}>{inner}</Link>
  ) : (
    <button type="button" onClick={activate} className={cls}>{inner}</button>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function Sidebar({
  className,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  onReportBug,
}: {
  className?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onReportBug?: () => void;
}) {
  const pathname = usePathname();
  const me = useMe();
  const isAdmin = canRole(me.role, 'admin');

  return (
    <aside className={cx('relative flex h-full w-full flex-col bg-rail', className)}>
      {/* Collapse toggle — a round button straddling the rail's right edge (HubSpot-style).
          Only on the desktop rail (AppShell passes onToggleCollapse there, not to the drawer). */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute right-0 top-1/2 z-40 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-panel-raised text-ink-muted shadow-md shadow-black/40 transition-colors hover:border-accent/60 hover:text-accent-soft"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
            {collapsed ? (
              <path fillRule="evenodd" d="M7.29 14.71a1 1 0 010-1.42L10.59 10 7.29 6.71a1 1 0 111.42-1.42l4 4a1 1 0 010 1.42l-4 4a1 1 0 01-1.42 0z" clipRule="evenodd" />
            ) : (
              <path fillRule="evenodd" d="M12.71 5.29a1 1 0 010 1.42L9.41 10l3.3 3.29a1 1 0 11-1.42 1.42l-4-4a1 1 0 010-1.42l4-4a1 1 0 011.42 0z" clipRule="evenodd" />
            )}
          </svg>
        </button>
      )}

      {/* Brand — logo + name only, fixed height, divider underneath. */}
      <div className={cx('flex h-16 shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-0' : 'gap-2.5 px-4')}>
        <BrandMark size={collapsed ? 28 : 30} className="shrink-0 rounded-lg shadow-lg shadow-accent-deep/40" />
        {!collapsed && <span className="text-[17px] font-bold text-ink">FormPing</span>}
      </div>

      {/* Nav */}
      <nav className={cx('flex-1', collapsed ? 'overflow-visible px-2 py-2' : 'overflow-y-auto px-3 py-2')}>
        {collapsed ? (
          <div className="space-y-1">
            {NAV.map((group) => (
              <CollapsedArea key={group.label} group={group} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {NAV.map((group) => {
              if (group.href) {
                return (
                  <div key={group.label}>
                    <NavLink href={group.href} icon={group.icon} active={isActive(pathname, group.href, group.matchPrefix)} onNavigate={onNavigate}>
                      {group.label}
                    </NavLink>
                  </div>
                );
              }
              return (
                <div key={group.label} className="space-y-0.5">
                  <div className="flex items-center gap-2.5 px-3 pb-1.5 text-sm font-semibold text-ink-secondary">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px] shrink-0 text-ink-muted" aria-hidden>
                      {group.icon}
                    </svg>
                    {group.label}
                  </div>
                  {group.children!.map((leaf) => (
                    <NavLink key={leaf.href} href={leaf.href} indent active={isActive(pathname, leaf.href)} onNavigate={onNavigate}>
                      {leaf.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Secondary — utilities (Docs, What's new, Team & access [admin+], Report a bug). */}
      <div className={cx('space-y-1 border-t border-line py-2', collapsed ? 'px-2' : 'px-3')}>
        <UtilityItem icon={ICON.docs} label="Docs" href="/docs" active={pathname === '/docs'} collapsed={collapsed} onNavigate={onNavigate} />
        <UtilityItem icon={ICON.whatsNew} label="What's new" href="/whats-new" active={pathname === '/whats-new'} collapsed={collapsed} onNavigate={onNavigate} />
        {isAdmin && (
          <UtilityItem icon={ICON.team} label="Team & access" href="/team" active={pathname === '/team'} collapsed={collapsed} onNavigate={onNavigate} />
        )}
        <UtilityItem icon={ICON.bug} label="Report a bug" onClick={onReportBug} collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* Profile pinned to the bottom */}
      <ProfileBlock collapsed={collapsed} />
    </aside>
  );
}
