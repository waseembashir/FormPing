'use client';
import { useEffect, useState } from 'react';

/**
 * Shared "we're working" loader shell (FR-76). The Form Tester and the Content
 * Changes monitor both showed the same ping-ring + headline + rotating "Did you
 * know?" card — this is the one source of truth for its look + size, so a change
 * here (type scale, height, spacing) lands everywhere the loader appears.
 *
 * Callers supply the glyph, copy, an optional `middle` slot (progress phases /
 * the multi-form narrative), how far along the run is, and the rotating facts.
 *
 * Progress IS the cat's path: the track fills up to the cat, who rides at the
 * frontier. `pct` is only ever a REAL fraction (derived from "page N/T" the
 * crawlers emit, or a batch's current/total) — when we genuinely don't know, it's
 * null and the cat runs on the spot with the ground scrolling under it, which
 * says "working" without inventing a percentage. A slim bar stands in on small
 * screens, where the cat is hidden.
 */
const DASHES = {
  backgroundImage: 'repeating-linear-gradient(to right, currentColor 0 6px, transparent 6px 12px)',
  backgroundSize: '12px 100%',
} as const;

/** Roughly how wide the cat renders at h-10 — used to keep her fully on the
 *  track at 0% and 100% instead of hanging off either end. */
const CAT_W = 40;

/** The cat on her path — the loader's progress indicator (sm+ only). */
function CatTrack({ pct }: { pct: number | null }) {
  const known = pct != null;
  const clamped = known ? Math.min(Math.max(pct, 0), 1) : 0;
  const left = `calc(${(clamped * 100).toFixed(1)}% - ${(clamped * CAT_W).toFixed(0)}px)`;

  return (
    <div className="relative hidden h-10 py-1 sm:block" aria-hidden>
      {/* The ground STILL AHEAD of her — dashes start where she is, never behind
          her. Drawing them full-width and painting the fill on top left the dashes
          showing through the covered stretch; the road she has run is done with. */}
      <div
        className={`absolute bottom-0 right-0 h-[3px] rounded-full text-accent-soft/35 ${known ? 'transition-all duration-500' : 'animate-track motion-reduce:animate-none'}`}
        style={{ ...DASHES, left: known ? `${(clamped * 100).toFixed(1)}%` : 0 }}
      />
      {/* Ground already covered — a smooth, solid run of colour that grows with
          her. Both ends fully opaque, so nothing beneath can read through it. */}
      {known && (
        <div
          className="absolute bottom-0 left-0 h-[3px] rounded-full bg-gradient-to-r from-accent-deep to-accent transition-all duration-500"
          style={{ width: `${(clamped * 100).toFixed(1)}%` }}
        />
      )}
      {/* GIF faces left by default; scaleX(-1) mirrors it to run rightward. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF: next/image would freeze it */}
      <img
        src="/running-cat.gif"
        alt=""
        className="absolute bottom-0 h-10 w-auto select-none invert transition-all duration-500"
        style={{ left: known ? left : '18%', transform: 'scaleX(-1)' }}
        draggable={false}
      />
    </div>
  );
}

export function RunLoaderShell({
  glyph,
  headline,
  sub,
  middle,
  pct,
  facts,
}: {
  glyph: React.ReactNode;
  headline: string;
  sub: string;
  middle?: React.ReactNode;
  /** 0..1 when progress is genuinely known; null/undefined = indeterminate. */
  pct?: number | null;
  facts: string[];
}) {
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    if (facts.length <= 1) return;
    const t = setInterval(() => setFactIdx((i) => (i + 1) % facts.length), 8000);
    return () => clearInterval(t);
  }, [facts.length]);

  return (
    <div className="fp-rise overflow-hidden rounded-xl border border-line bg-panel p-6 sm:p-7">
      <div className="flex items-start gap-4">
        {/* Animated ping rings — on-brand (form + ping). Top-aligned with the heading. */}
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-11 w-11 animate-ping rounded-full bg-accent/15 [animation-duration:2s] motion-reduce:animate-none" aria-hidden />
          <span className="absolute h-14 w-14 rounded-full border border-accent/15" aria-hidden />
          <span className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-panel-raised text-accent-soft ring-1 ring-line-strong">
            {glyph}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink">{headline}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{sub}</p>
          {middle}
        </div>
      </div>

      {/* PROGRESS = the cat's path. The track fills up to the cat, who rides at
          the frontier when we truly know how far along we are; otherwise she runs
          on the spot while the ground scrolls under her. */}
      <div className="mt-7 sm:mt-8">
        <CatTrack pct={pct ?? null} />
        {/* Small screens hide the cat, so they get the plain bar instead. */}
        <div className="sm:hidden">
          {pct == null ? (
            <div className="fp-indeterminate h-1 w-full rounded-full bg-line" />
          ) : (
            <div className="h-1 w-full overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-7 flex items-start gap-2.5 border-t border-line pt-5">
        <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" aria-hidden>
          <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2A6 6 0 0012 3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p key={factIdx} className="fp-rise text-sm leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink-secondary">Did you know?</span> {facts[factIdx]}
        </p>
      </div>
    </div>
  );
}
