/**
 * Types for Projects — a client-grouping layer that sits ON TOP of the existing
 * Form Watch / Site Watch monitors. A Project is just a name + a set of URLs;
 * the per-URL health is DERIVED by matching those URLs to existing monitors, so
 * nothing about the monitors themselves changes (fully additive).
 */

import type { FormRunDetail } from '../formRunDetail';
import type { SiteCheckDetail } from '../siteWatch/resultStore';

export interface Project {
  id: string;
  /** Client / project name. */
  name: string;
  /** The client's URLs (form pages, site roots, etc.). */
  urls: string[];
  notes?: string;
  /** Who to notify for this client — email / Slack handle / name. Seeds routing. */
  contact?: string;
  /**
   * Opt-in public status-page token. When set, the client-safe status page is
   * reachable at /status/<shareToken> WITHOUT auth (see middleware allowlist).
   * Absent/empty = no public page. Unguessable + revocable (regenerate/clear).
   */
  shareToken?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Display name (snapshot) of whoever created the project — attribution (FR-30). */
  createdBy?: string | null;
  /** Display name (snapshot) of whoever last edited it — attribution (FR-30). */
  updatedBy?: string | null;
}

export type FormHealthLevel = 'healthy' | 'detected' | 'attention' | 'failing' | 'pending';
export type SiteUpState = 'up' | 'down' | 'blocked' | 'unknown';

/** Derived health for one URL in a project (read from the existing monitors). */
export interface UrlHealth {
  url: string;
  /** Contact-form health, from Form Watch (if this URL is monitored there). */
  form: {
    monitored: boolean;
    /** True when NOT actively monitored but a persisted last result exists
     *  (the monitor was stopped/deleted; the result stays until project delete). */
    stopped?: boolean;
    level?: FormHealthLevel;
    /** Raw reason code of the last run — lets the client status page distinguish
     *  "we couldn't find a contact page to test" from "the form is broken". */
    reasonCode?: string;
    /** What happened on the last run (e.g. "Form healthy — filled, not submitted"). */
    label?: string;
    /** Which test ran: 'live' | 'safe' | 'detect-only'. */
    mode?: string;
    /** Check cadence, in ms. */
    intervalMs?: number;
    lastRunAt?: string | null;
    /** FR-67 — what the monitor's last check actually found: which form, its
     *  type, fields, confidence, and the other forms on the site. The scheduler
     *  runs the same engine as the manual tester, so its dashboard shows the
     *  same depth. Absent for checks recorded before the column existed. */
    detail?: FormRunDetail;
  };
  /** Uptime + SSL, from Site Watch (if this URL is monitored there). */
  site: {
    monitored: boolean;
    /** True when NOT actively monitored but a persisted last result exists. */
    stopped?: boolean;
    upState?: SiteUpState;
    statusCode?: number | null;
    responseMs?: number | null;
    sslDaysRemaining?: number | null;
    /** Days until domain registration expires (from Site Watch's RDAP check). */
    domainDaysRemaining?: number | null;
    /** Check cadence, in ms. */
    intervalMs?: number;
    lastCheckedAt?: string | null;
    /** FR-67 — who issued the certificate and when it expires, who the domain is
     *  registered with and when that lapses, and why a failing check failed.
     *  Measured on every check; previously discarded. */
    detail?: SiteCheckDetail;
  };
  /**
   * Content-change tracking, from the Change Monitor. Tracking is per-HOSTNAME
   * (the monitor crawls a whole site from its homepage), so URLs sharing a host
   * share this — the UI labels it as site-level. Reads the newest change EVENT,
   * which covers all three modes including a `snapshot` that produced no report.
   * Undefined when the host has never been tracked.
   */
  change?: {
    tracked: boolean;
    /** How the most recent run was performed. */
    mode?: 'snapshot' | 'compare' | 'watch';
    lastCheckedAt?: string | null;
    changesFound?: number;
    pagesChanged?: number;
    pagesScanned?: number;
    severity?: 'low' | 'medium' | 'high';
    summary?: string;
  };
  /** Last on-demand Form Tester run for this URL (manual run, persisted best-effort). */
  lastRun?: {
    finalStatus: 'pass' | 'fail' | 'warn' | 'error';
    reasonCode?: string;
    mode?: string;
    formFound?: boolean;
    ranAt: string;
    /** How long the run took, in ms. */
    durationMs?: number;
    /** FR-67 — the rich facts of that run (form type, fields, why-failed…).
     *  Absent for runs recorded before the detail column existed. */
    detail?: FormRunDetail;
  };
}

/** A project plus the derived health of each of its URLs. */
export interface ProjectWithHealth extends Project {
  health: UrlHealth[];
}

/**
 * Compact, project-level health summary (the "worst across all URLs") used for
 * the list/table view + worst-first sorting.
 */
export interface ProjectRollup {
  /** True if at least one URL is monitored (form or site). */
  monitored: boolean;
  /** Worst contact-form level across the project's URLs. */
  formLevel?: FormHealthLevel;
  formLabel?: string;
  /** At least one URL's form is a recognised third-party embed ("detected").
   *  Surfaces the sky "Detected" pill when nothing worse needs attention. FR-60. */
  hasDetected?: boolean;
  /** Worst uptime state across the project's URLs. */
  upState?: SiteUpState;
  /** Soonest SSL expiry (min days) across the project's URLs, or null. */
  sslSoonest: number | null;
  /** Soonest domain-registration expiry (min days) across the project's URLs, or null. */
  domainSoonest: number | null;
  /** Most recent check time across the project's monitors, or null. */
  lastChecked: string | null;
  /** Higher = worse; drives worst-first sorting. Unmonitored = -1 (bottom). */
  severity: number;
}

/** A project plus its rollup summary (list/table response). */
export interface ProjectWithRollup extends Project {
  rollup: ProjectRollup;
}
