/**
 * Types for Projects — a client-grouping layer that sits ON TOP of the existing
 * Form Watch / Site Watch monitors. A Project is just a name + a set of URLs;
 * the per-URL health is DERIVED by matching those URLs to existing monitors, so
 * nothing about the monitors themselves changes (fully additive).
 */

export interface Project {
  id: string;
  /** Client / project name. */
  name: string;
  /** The client's URLs (form pages, site roots, etc.). */
  urls: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type FormHealthLevel = 'healthy' | 'attention' | 'failing' | 'pending';
export type SiteUpState = 'up' | 'down' | 'blocked' | 'unknown';

/** Derived health for one URL in a project (read from the existing monitors). */
export interface UrlHealth {
  url: string;
  /** Contact-form health, from Form Watch (if this URL is monitored there). */
  form: {
    monitored: boolean;
    level?: FormHealthLevel;
    /** What happened on the last run (e.g. "Form healthy — filled, not submitted"). */
    label?: string;
    /** Which test ran: 'live' | 'safe' | 'detect-only'. */
    mode?: string;
    /** Check cadence, in ms. */
    intervalMs?: number;
    lastRunAt?: string | null;
  };
  /** Uptime + SSL, from Site Watch (if this URL is monitored there). */
  site: {
    monitored: boolean;
    upState?: SiteUpState;
    statusCode?: number | null;
    responseMs?: number | null;
    sslDaysRemaining?: number | null;
    /** Check cadence, in ms. */
    intervalMs?: number;
    lastCheckedAt?: string | null;
  };
  /**
   * Content-change tracking, from the Change Monitor. Tracking is per-hostname
   * (the monitor crawls a whole site), so URLs sharing a host share this. Reads
   * the newest persisted report; undefined when the host has never been monitored.
   */
  change?: {
    tracked: boolean;
    lastCheckedAt?: string | null;
    changesFound?: number;
    pagesChanged?: number;
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
  /** Worst uptime state across the project's URLs. */
  upState?: SiteUpState;
  /** Soonest SSL expiry (min days) across the project's URLs, or null. */
  sslSoonest: number | null;
  /** Most recent check time across the project's monitors, or null. */
  lastChecked: string | null;
  /** Higher = worse; drives worst-first sorting. Unmonitored = -1 (bottom). */
  severity: number;
}

/** A project plus its rollup summary (list/table response). */
export interface ProjectWithRollup extends Project {
  rollup: ProjectRollup;
}
