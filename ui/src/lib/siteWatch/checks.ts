/**
 * The two Site Watch probes. Both are dependency-free and lightweight:
 *   - uptime: a single HTTP GET (Node fetch) — status + response time
 *   - ssl:    a TLS handshake (Node 'tls') — reads the cert expiry
 *
 * No browser, no external API, no proxy. Free.
 */

import type { UptimeResult, SslResult, DomainResult, UptimeClass } from './types';

// Node's `tls` is loaded via webpack's runtime require (not a static import).
// Next compiles the instrumentation hook for the Edge runtime as well, and Edge
// has no `tls`; a static import would pull it into that graph and fail the build.
// `checkSsl` only ever runs in the Node.js runtime, so this is safe.
declare const __non_webpack_require__: NodeRequire;
function nodeTls(): typeof import('node:tls') {
  return __non_webpack_require__('node:tls');
}

/**
 * True if the hostname actually resolves in DNS — i.e. the domain exists.
 * A typo'd / non-existent domain throws (ENOTFOUND) → false. This is the one
 * reliable automatic "is this a real domain?" signal. (Note: platforms with
 * wildcard DNS like *.netlify.app resolve ANY subdomain, so this can't tell a
 * deployed site from an undeployed one — only that the domain exists.)
 */
export async function hostResolves(hostname: string): Promise<boolean> {
  try {
    const dns = __non_webpack_require__('node:dns/promises') as typeof import('node:dns/promises');
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

const TIMEOUT_MS = 15000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Markers that mean "the host answered but with a bot challenge", not a real outage. */
const CHALLENGE_MARKERS =
  /just a moment|checking your browser|cf-browser-verification|attention required|cloudflare|access denied/i;

/** HTTP GET the URL and classify the result. */
export async function checkUptime(url: string): Promise<UptimeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    const responseMs = Date.now() - start;
    const status = res.status;

    let classification: UptimeClass;
    if (status >= 200 && status < 400) {
      classification = 'up';
    } else if (status === 403 || status === 429 || status === 503) {
      // Could be a bot challenge (reachable) rather than a real outage — peek.
      const body = await res.text().catch(() => '');
      classification = CHALLENGE_MARKERS.test(body) ? 'blocked' : 'down';
    } else {
      classification = 'down';
    }

    return { classification, statusCode: status, responseMs };
  } catch (err) {
    // Network error / timeout / refused → down.
    return {
      classification: 'down',
      statusCode: null,
      responseMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read the site's TLS certificate and compute days-until-expiry.
 * `rejectUnauthorized: false` so we can still READ an expired/invalid cert —
 * detecting expiry is the whole point, so we must not refuse the connection.
 */
export function checkSsl(hostname: string, port = 443): Promise<SslResult> {
  const tls = nodeTls();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: SslResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          done({ ok: false, daysRemaining: null, validTo: null, issuer: null, error: 'No certificate' });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysRemaining = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
        // Node types these cert fields as string | string[] — normalize to a string.
        const issuerRaw = cert.issuer && (cert.issuer.O || cert.issuer.CN);
        const issuer = issuerRaw
          ? Array.isArray(issuerRaw)
            ? issuerRaw.join(', ')
            : String(issuerRaw)
          : null;
        done({ ok: true, daysRemaining, validTo: validTo.toISOString(), issuer });
      },
    );

    socket.on('error', (err) =>
      done({ ok: false, daysRemaining: null, validTo: null, issuer: null, error: err.message }),
    );
    socket.on('timeout', () => {
      socket.destroy();
      done({ ok: false, daysRemaining: null, validTo: null, issuer: null, error: 'TLS timeout' });
    });
  });
}

// ── Domain-registration expiry (RDAP) ────────────────────────────────────────
// RDAP is the modern, free, structured replacement for WHOIS: a plain HTTPS GET
// returning JSON. `rdap.org` is a public bootstrap that redirects to the right
// registry. No API key. Covers most gTLDs; unsupported registries just 404 →
// we degrade to "unknown" (never a false alert). A silently-expired *domain*
// takes the whole site down, so this pairs naturally with the SSL check.

const RDAP_TIMEOUT_MS = 10000;

/** A few common multi-label public suffixes so we query the *registrable* domain
 *  (e.g. `foo.co.uk`, not `co.uk`). Best-effort — a wrong guess just 404s → unknown. */
const MULTI_LABEL_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'com.br', 'com.mx', 'com.sg',
  'co.in', 'net.in', 'org.in',
  'co.jp', 'or.jp', 'ne.jp',
]);

/** Strip subdomains down to the registrable domain (best-effort). */
export function registrableDomain(hostname: string): string {
  const h = hostname.replace(/^www\./i, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_LABEL_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

interface RdapEvent { eventAction?: string; eventDate?: string }
interface RdapEntity { roles?: string[]; handle?: string; vcardArray?: unknown }
interface RdapResponse { events?: RdapEvent[]; entities?: RdapEntity[] }

/** Pull the registrar's display name out of the RDAP entity vCard (best-effort). */
function extractRegistrar(entities: RdapEntity[] | undefined): string | null {
  if (!Array.isArray(entities)) return null;
  const reg = entities.find((e) => Array.isArray(e.roles) && e.roles.includes('registrar'));
  if (!reg) return null;
  const vcard = Array.isArray(reg.vcardArray) ? reg.vcardArray[1] : null;
  if (Array.isArray(vcard)) {
    const fn = (vcard as unknown[]).find((f) => Array.isArray(f) && f[0] === 'fn') as
      | unknown[]
      | undefined;
    if (fn && typeof fn[3] === 'string') return fn[3];
  }
  return typeof reg.handle === 'string' ? reg.handle : null;
}

/**
 * Look up domain-registration expiry via RDAP. Returns a `DomainResult`; on any
 * failure (unsupported TLD, network, no expiry field) returns `ok:false` with an
 * error — never throws, so a domain lookup can never break an uptime/SSL cycle.
 */
export async function checkDomain(hostname: string): Promise<DomainResult> {
  const none = (error: string): DomainResult => ({
    ok: false,
    daysRemaining: null,
    expiryDate: null,
    registrar: null,
    error,
  });
  const domain = registrableDomain(hostname);
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
      headers: { Accept: 'application/rdap+json', 'User-Agent': UA },
    });
    if (!res.ok) return none(`RDAP ${res.status}`);
    const data = (await res.json()) as RdapResponse;
    const events = Array.isArray(data.events) ? data.events : [];
    const exp = events.find((e) => e.eventAction === 'expiration' && typeof e.eventDate === 'string');
    if (!exp || !exp.eventDate) return none('no expiry in RDAP record');
    const ms = Date.parse(exp.eventDate);
    if (Number.isNaN(ms)) return none('unparseable expiry date');
    const daysRemaining = Math.floor((ms - Date.now()) / 86_400_000);
    return {
      ok: true,
      daysRemaining,
      expiryDate: new Date(ms).toISOString(),
      registrar: extractRegistrar(data.entities),
    };
  } catch (err) {
    return none(
      err instanceof Error ? (err.name === 'TimeoutError' ? 'RDAP timeout' : err.message) : 'RDAP lookup failed',
    );
  }
}
