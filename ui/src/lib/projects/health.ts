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
import { loadResults as loadFormResults, type FormWatchResult } from '@/lib/formWatch/resultStore';
import { loadResults as loadSiteResults, type SiteWatchResult } from '@/lib/siteWatch/resultStore';
import { rollupFromHealth } from './rollup';
import { loadReports } from '@/lib/reportStore';
import { loadRuns, type OnDemandRun } from '@/lib/onDemandRunStore';
import { listDismissed } from './dismissedStore';
import { runVerdict } from '@/lib/formWatch/verdict';
import { urlKey as key, projectStore } from './projectStore';
import type { ProjectRollup, UrlHealth } from './types';

/** Re-exported for callers that already import it from here. The canonical
 *  definition lives in projectStore — do NOT redefine it. */
export { key as urlKey };

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
type FormResultMap = Map<string, FormWatchResult>;
type SiteResultMap = Map<string, SiteWatchResult>;

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
  formResults?: FormResultMap,
  siteResults?: SiteResultMap,
): UrlHealth[] {
  return urls.map((url) => {
    const fs = forms.get(key(url));
    const ss = sites.get(key(url));
    const fr = formResults?.get(key(url));
    const sr = siteResults?.get(key(url));

    // Form: live schedule when monitored; else the durable last result (the
    // monitor was stopped/deleted but the result stays until the project is).
    let form: UrlHealth['form'];
    if (fs) {
      form = {
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
      };
    } else if (fr) {
      const v = runVerdict(fr.reasonCode, fr.formFound, fr.status === 'error' ? 'error' : undefined);
      form = { monitored: false, stopped: true, level: v.level, label: v.label, mode: fr.mode, lastRunAt: fr.ranAt };
    } else {
      form = { monitored: false };
    }

    // Site: same — live schedule, else the durable last result.
    let site: UrlHealth['site'];
    if (ss) {
      site = {
        monitored: true,
        upState: ss.lastClassification ?? 'unknown',
        statusCode: ss.lastStatusCode ?? null,
        responseMs: ss.lastResponseMs ?? null,
        sslDaysRemaining: ss.lastSslDaysRemaining ?? null,
        domainDaysRemaining: ss.lastDomainDaysRemaining ?? null,
        intervalMs: ss.intervalMs,
        lastCheckedAt: ss.lastCheckedAt,
      };
    } else if (sr) {
      site = {
        monitored: false,
        stopped: true,
        upState: sr.classification ?? 'unknown',
        statusCode: sr.statusCode,
        responseMs: sr.responseMs,
        sslDaysRemaining: sr.sslDaysRemaining,
        domainDaysRemaining: sr.domainDaysRemaining,
        lastCheckedAt: sr.checkedAt,
      };
    } else {
      site = { monitored: false };
    }

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
  const [{ forms, sites }, changes, runs, formResults, siteResults] = await Promise.all([
    loadMaps(),
    loadChanges(urls),
    loadRuns(),
    loadFormResults(),
    loadSiteResults(),
  ]);
  return buildHealth(urls, forms, sites, changes, runs, formResults, siteResults);
}

// ── Rollup ──────────────────────────────────────────────────────────────────
// The pure worst-case rollup lives in ./rollup (client-safe). Re-exported so
// existing importers of `@/lib/projects/health` keep working unchanged.
export { rollupFromHealth };

/** Rollups for many projects, reading the monitor stores only ONCE. */
export async function rollupsForUrlSets(urlSets: string[][]): Promise<ProjectRollup[]> {
  // The persisted results are needed here too: without them a stopped monitor's
  // URL has no `stopped` flag, so the list row showed "—" and "never" even though
  // we still hold its last result.
  const [{ forms, sites }, formResults, siteResults] = await Promise.all([
    loadMaps(),
    loadFormResults(),
    loadSiteResults(),
  ]);
  return urlSets.map((urls) =>
    rollupFromHealth(buildHealth(urls, forms, sites, undefined, undefined, formResults, siteResults)),
  );
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
  const [monitored, runs, projects, dismissed, formResults, siteResults] = await Promise.all([
    listMonitoredUrls(),
    loadRuns(),
    projectStore.list(),
    listDismissed(),
    loadFormResults(),
    loadSiteResults(),
  ]);
  const assigned = new Set(projects.flatMap((p) => p.urls).map(key));
  // Union of monitored + manually-tested + persisted-result URLs (the last covers
  // stopped monitors whose result we keep), de-duplicated by normalized key
  // (keep the first-seen original URL form for display).
  const byKey = new Map<string, string>();
  for (const u of monitored) byKey.set(key(u), u);
  for (const r of runs.values()) {
    if (!byKey.has(key(r.inputUrl))) byKey.set(key(r.inputUrl), r.inputUrl);
  }
  for (const r of [...formResults.values(), ...siteResults.values()]) {
    if (!byKey.has(key(r.inputUrl))) byKey.set(key(r.inputUrl), r.inputUrl);
  }
  return [...byKey.values()].filter((u) => !assigned.has(key(u)) && !dismissed.has(key(u)));
}
