'use client';

import { usePathname } from 'next/navigation';
import { Header } from './Header';

/**
 * Renders the app Header on every page EXCEPT the login screen.
 *
 * Lives in the root layout so the header is mounted ONCE and persists across
 * client navigations. Previously each page rendered its own <Header/>, so the
 * header re-mounted on every navigation — which caused a visible "jump" when
 * switching tabs on desktop. A persistent header re-renders (active state
 * updates) without re-mounting, so navigation is smooth.
 */
export function AppChrome() {
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return <Header />;
}
