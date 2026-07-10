/**
 * Derives per-URL health for a project by matching its URLs to the EXISTING
 * Form Watch + Site Watch monitors, plus a compact project-level rollup for the
 * list/table view. Read-only: it never modifies those stores, so Projects is a
 * pure overlay on top of the monitors.
 */

import type { FormSchedule } from '@/lib/formWatch/types';
import type { SiteSchedule } from '@/lib/siteWatch/types';
import type { ChangeReport, ChangeSeverity } from '@/types';
import { listSchedules as listFormSchedules } from '@/lib/formWatch/scheduleStore';
import { listSchedules as listSiteSchedules } from '@/lib/siteWatch/scheduleStore';
import { loadReports } from '@/lib/reportStore';
import { loadRuns, type OnDemandRun } from '@/lib/onDemandRunStore';
import { listDismissed } from './dismissedStore';
import { runVerdict } from '@/lib/formWatch/verdict';
import { normalizeUrl, projectStore } from './projectStore';
import type { ProjectRollup, UrlHealth } from './types';

function key(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

/** Exposed so routes match URLs to monitors the same way Projects does. */
export const urlKey = key;

/** Hostname key the Change Monitor stores reports under (must match siteKey()). */
function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

type FormMap = Map<string, FormSchedule>;
type SiteMap = Map<string, SiteSchedule>;

interface ChangeSummary {
  lastCheckedAt: string | null;
  changesFound: number;
  pagesChanged: number;
  severity?: ChangeSeverity;
  summary: string;
}
type ChangeMap = Map<string, ChangeSummary>; // keyed by hostKey
type RunMap = Map<string, OnDemandRun>; // keyed by key()

const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Pure: build per-URL health from pre-loaded monitor maps (no I/O). The
 *  optional changes/runs maps enrich the DETAIL view; the list/rollup path
 *  omits them (the rollup ignores them anyway). */
function buildHealth(
  urls: string[],
  forms: FormMap,
  sites: SiteMap,
  changes?: ChangeMap,
  runs?: RunMap,
): UrlHealth[] {
  return urls.map((url) => {
    const fs = forms.get(key(url));
    const ss = sites.get(key(url));

    const form: UrlHealth['form'] = fs
      ? {
          monitored: true,
          level: fs.lastStatus
            ? runVerdict(fs.lastReasonCode ?? '', fs.lastFormFound ?? false, fs.lastStatus).level
            : 'pending',
          label: fs.lastStatus
            ? runVerdict(fs.lastReasonCode ?? '', fs.lastFormFound ?? false, fs.lastStatus).label
            : 'Pending first run',
          mode: fs.mode,
          intervalMs: fs.intervalMs,
          lastRunAt: fs.lastRunAt,
        }
      : { monitored: false };

    const site: UrlHealth['site'] = ss
      ? {
          monitored: true,
          upState: ss.lastClassification ?? 'unknown',
          statusCode: ss.lastStatusCode ?? null,
          responseMs: ss.lastResponseMs ?? null,
          sslDaysRemaining: ss.lastSslDaysRemaining ?? null,
          domainDaysRemaining: ss.lastDomainDaysRemaining ?? null,
          intervalMs: ss.intervalMs,
          lastCheckedAt: ss.lastCheckedAt,
        }
      : { monitored: false };

    const cs = changes?.get(hostKey(url));
    const change: UrlHealth['change'] = cs
      ? {
          tracked: true,
          lastCheckedAt: cs.lastCheckedAt,
          changesFound: cs.changesFound,
          pagesChanged: cs.pagesChanged,
          severity: cs.severity,
          summary: cs.summary,
        }
      : undefined;

    const lr = runs?.get(key(url));
    const lastRun: UrlHealth['lastRun'] = lr
      ? {
          finalStatus: lr.finalStatus,
          reasonCode: lr.reasonCode,
          mode: lr.mode,
          formFound: lr.formFound,
          ranAt: lr.ranAt,
        }
      : undefined;

    return { url, form, site, change, lastRun };
  });
}

async function loadMaps(): Promise<{ forms: FormMap; sites: SiteMap }> {
  const [forms, sites] = await Promise.all([listFormSchedules(), listSiteSchedules()]);
  return {
    forms: new Map(forms.map((s) => [key(s.url), s])),
    sites: new Map(sites.map((s) => [key(s.url), s])),
  };
}

/** Newest change report per distinct hostname among the given URLs. */
async function loadChanges(urls: string[]): Promise<ChangeMap> {
  const hosts = Array.from(new Set(urls.map(hostKey))).filter((h) => h !== 'unknown');
  const map: ChangeMap = new Map();
  await Promise.all(
    hosts.map(async (host) => {
      const reports = await loadReports(host, 1);
      if (reports.length === 0) return;
      const rep = reports[0]!.report as Partial<ChangeReport> | null;
      if (!rep || typeof rep !== 'object') return;

      let severity: ChangeSeverity | undefined;
      for (const d of rep.details ?? []) {
        if (d?.severity && (!severity || SEV_RANK[d.severity] > SEV_RANK[severity])) {
          severity = d.severity;
        }
      }

      map.set(host, {
        lastCheckedAt: typeof rep.checkedAt === 'string' ? rep.checkedAt : reports[0]!.timestamp,
        changesFound: typeof rep.changesFound === 'number' ? rep.changesFound : 0,
        pagesChanged: typeof rep.pagesChanged === 'number' ? rep.pagesChanged : 0,
        severity,
        summary: typeof rep.summary === 'string' ? rep.summary : '',
      });
    }),
  );
  return map;
}

/** Per-URL health for a single project's URLs (used by the detail endpoint).
 *  Enriched with Change Monitor status + last on-demand run for the one-stop view. */
export async function urlHealthFor(urls: string[]): Promise<UrlHealth[]> {
  const [{ forms, sites }, changes, runs] = await Promise.all([
    loadMaps(),
    loadChanges(urls),
    loadRuns(),
  ]);
  return buildHealth(urls, forms, sites, changes, runs);
}

// ── Rollup ──────────────────────────────────────────────────────────────────
const FORM_RANK: Record<string, number> = { healthy: 0, pending: 1, attention: 2, failing: 3 };
const UP_RANK: Record<string, number> = { up: 0, unknown: 1, blocked: 2, down: 3 };

/** Pure: collapse a project's per-URL health into a worst-case rollup. */
export function rollupFromHealth(health: UrlHealth[]): ProjectRollup {
  let formLevel: ProjectRollup['formLevel'];
  let formLabel: string | undefined;
  let upState: ProjectRollup['upState'];
  let sslSoonest: number | null = null;
  let domainSoonest: number | null = null;
  let lastChecked: string | null = null;
  let monitored = false;

  const newer = (a: string | null, b: string | null | undefined) =>
    b && (!a || b > a) ? b : a;

  for (const h of health) {
    if (h.form.monitored) {
      monitored = true;
      if (h.form.level && (!formLevel || FORM_RANK[h.form.level] > FORM_RANK[formLevel])) {
        formLevel = h.form.level;
        formLabel = h.form.label;
      }
      lastChecked = newer(lastChecked, h.form.lastRunAt);
    }
    if (h.site.monitored) {
      monitored = true;
      if (h.site.upState && (!upState || UP_RANK[h.site.upState] > UP_RANK[upState])) {
        upState = h.site.upState;
      }
      if (h.site.sslDaysRemaining != null) {
        sslSoonest = sslSoonest == null ? h.site.sslDaysRemaining : Math.min(sslSoonest, h.site.sslDaysRemaining);
      }
      if (h.site.domainDaysRemaining != null) {
        domainSoonest =
          domainSoonest == null
            ? h.site.domainDaysRemaining
            : Math.min(domainSoonest, h.site.domainDaysRemaining);
      }
      lastChecked = newer(lastChecked, h.site.lastCheckedAt);
    }
  }

  // Severity (higher = worse) for worst-first sorting.
  let severity = 0;
  if (formLevel) severity = Math.max(severity, FORM_RANK[formLevel] * 10);
  if (upState) severity = Math.max(severity, UP_RANK[upState] * 10);
  if (sslSoonest != null && sslSoonest <= 14) severity = Math.max(severity, 25);
  else if (sslSoonest != null && sslSoonest <= 30) severity = Math.max(severity, 15);
  if (domainSoonest != null && domainSoonest <= 14) severity = Math.max(severity, 25);
  else if (domainSoonest != null && domainSoonest <= 30) severity = Math.max(severity, 15);
  if (!monitored) severity = -1; // unmonitored sinks to the bottom

  return { monitored, formLevel, formLabel, upState, sslSoonest, domainSoonest, lastChecked, severity };
}

/** Rollups for many projects, reading the monitor stores only ONCE. */
export async function rollupsForUrlSets(urlSets: string[][]): Promise<ProjectRollup[]> {
  const { forms, sites } = await loadMaps();
  return urlSets.map((urls) => rollupFromHealth(buildHealth(urls, forms, sites)));
}

// ── Unassigned (orphan) monitors ──────────────────────────────────────────────
// "No orphans": every URL that has a monitor must be reachable from Projects.

/** Every distinct URL that has a Form Watch or Site Watch monitor. */
export async function listMonitoredUrls(): Promise<string[]> {
  const [forms, sites] = await Promise.all([listFormSchedules(), listSiteSchedules()]);
  const byKey = new Map<string, string>();
  for (const s of [...forms, ...sites]) {
    const k = key(s.url);
    if (!byKey.has(k)) byKey.set(k, s.url); // keep first-seen original URL form
  }
  return [...byKey.values()];
}

/**
 * URLs that aren't in any project — the synthetic "Unassigned" bucket. Includes
 * BOTH monitored URLs (Form/Site Watch schedules) AND manually-tested URLs (the
 * on-demand run store) — so a URL you just tested in the Form Tester shows up
 * here to assign or dismiss, not just monitored ones. Excludes URLs the user
 * explicitly dismissed ("No, don't track"), so a deliberate throwaway stays out.
 */
export async function listUnassignedUrls(): Promise<string[]> {
  const [monitored, runs, projects, dismissed] = await Promise.all([
    listMonitoredUrls(),
    loadRuns(),
    projectStore.list(),
    listDismissed(),
  ]);
  const assigned = new Set(projects.flatMap((p) => p.urls).map(key));
  // Union of monitored + manually-tested URLs, de-duplicated by normalized key
  // (keep the first-seen original URL form for display).
  const byKey = new Map<string, string>();
  for (const u of monitored) byKey.set(key(u), u);
  for (const r of runs.values()) {
    const k = key(r.inputUrl);
    if (!byKey.has(k)) byKey.set(k, r.inputUrl);
  }
  return [...byKey.values()].filter((u) => !assigned.has(key(u)) && !dismissed.has(key(u)));
}
