'use client';

/**
 * FR-73 — the evidence block: a picture of the form we matched, and a link that
 * jumps straight to it on the live page.
 *
 * The tester used to hand over a verdict and nothing to check it against. When
 * it matched a stray footer input and reported "Form found · 1 field · OK",
 * there was no way to catch it from the card. A cropped screenshot settles that
 * in a second, and the deep link lets you go and look for yourself.
 *
 * The image is a hosted URL, never inline data — see lib/formShots.ts for why
 * that boundary matters to the app's speed. It is lazy, so opening the report
 * costs nothing until you actually look at a form's tab.
 */

function CameraIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 7.5A1.5 1.5 0 014 6h1.6l.9-1.6h7l.9 1.6H16a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5v-7z" />
      <circle cx="10" cy="11" r="2.75" />
    </svg>
  );
}

/**
 * The screenshot of one form. Renders nothing without a shot — an empty frame
 * would imply we looked and saw nothing, which isn't what a missing shot means.
 */
export function FormShot({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
        <CameraIcon />
        The form we matched
      </figcaption>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title="Open the full-size screenshot"
        className="group block overflow-hidden rounded-lg border border-line bg-ground/30 transition-colors hover:border-line-strong"
      >
        {/* The WHOLE form, never a crop. `object-contain` scales a tall form down
            to fit rather than slicing off everything below the first field or
            two — a picture of half a form is not evidence of which form it is.
            Click through for it at full size. `loading=lazy` keeps a closed tab
            free of network cost.
            A plain <img>, not next/image: the source is an arbitrary Supabase
            Storage URL with unknown dimensions, so there is nothing for the
            optimizer to pre-size, and routing it through /_next/image would add
            a server hop to every screenshot. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[32rem] w-full object-contain"
        />
      </a>
    </figure>
  );
}

/**
 * The form's address, as ONE link.
 *
 * There was briefly a separate "Jump to this form" button beside the page URL.
 * It was redundant: same page, one extra control, and all it added was the
 * `#anchor` that scrolls to the form. So the anchor rides on the URL itself.
 *
 * It is deliberately NOT displayed. An id like `#forminator-module-653` is
 * generated markup, and dropping it into the middle of an address a person has
 * to read costs more than the jump is worth. Callers show the clean URL, link to
 * this href, and name the anchor in the tooltip. FR-73.
 */
export function formHref(url: string, anchorId?: string): string {
  return anchorId ? `${url.split('#')[0]}#${anchorId}` : url;
}

/**
 * Says plainly that we are not sure — shown instead of a confident pass whenever
 * the detector settled for a weak match. Sky/info, deliberately: nothing is
 * broken, we just can't promise this is the form you mean.
 */
export function LowConfidenceNote({ reason }: { reason?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info/8 px-3.5 py-2.5">
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-info" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 13.5v-4M10 6.8v.1M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z" />
      </svg>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-info">We are not certain this is your contact form</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          {reason
            ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`
            : 'This form is missing the usual contact signals.'}{' '}
          Have a look at the screenshot — if it is the wrong form, the real one is probably on another page.
        </p>
      </div>
    </div>
  );
}

/**
 * Bot protection seen on the PAGE but not on this form. Said quietly and
 * separately, because it is a fact about the page: claiming it as "this form is
 * CAPTCHA protected" is exactly the false confidence FR-73 removed.
 */
export function PageProtectionNote({ unreadableEmbed }: { unreadableEmbed?: boolean }) {
  // "not attached to this form" is a claim about the form's contents. We cannot
  // make it about a form we cannot see into — and the screenshot may plainly
  // show a reCAPTCHA badge sitting on it. FR-84.
  if (unreadableEmbed) {
    return (
      <p className="text-xs leading-relaxed text-ink-faint">
        <span className="font-semibold text-ink-secondary">Bot protection on this page.</span>{' '}
        We found reCAPTCHA/Turnstile code on the page. Because this form is hosted elsewhere we can&rsquo;t see inside
        it, so we can&rsquo;t tell you whether it protects this form — check the picture above.
      </p>
    );
  }
  return (
    <p className="text-xs leading-relaxed text-ink-faint">
      <span className="font-semibold text-ink-secondary">Bot protection on this page.</span>{' '}
      We found reCAPTCHA/Turnstile code on the page, but not attached to this form — it may still challenge a real
      submission.
    </p>
  );
}

/**
 * Why a hosted form shows no field count — and what to do about it.
 *
 * Leads with what we DID establish (it loaded, here is the picture) and ends
 * with the one action left to the user, rather than a paragraph about our
 * limitations. An earlier version explained at length that we couldn't check
 * the CAPTCHA either; the frame-tree check now answers that, and the chip above
 * says so, so the sentence went. FR-84.
 */
export function EmbedUnreadableNote({ provider }: { provider?: string }) {
  const name = provider?.trim() || 'another service';
  return (
    <p className="text-xs leading-relaxed text-ink-faint">
      <span className="font-semibold text-ink-secondary">Hosted by {name} — it loaded correctly.</span>{' '}
      We can&rsquo;t fill or read a form inside another company&rsquo;s frame, so send one test through it yourself to
      confirm it reaches you.
    </p>
  );
}
