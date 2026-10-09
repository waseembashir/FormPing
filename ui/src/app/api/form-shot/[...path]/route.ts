import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';
import { isSafeShotPath } from '@/lib/formShotSrc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The bucket holding form screenshots. Must match `formShots.ts`. */
const BUCKET = 'form-shots';

/**
 * GET /api/form-shot/<storage key> — a form screenshot, for signed-in staff.
 *
 * Screenshots are internal evidence and every other internal surface is
 * auth-gated; the images were the one that was not. They lived in a
 * public-read bucket, protected only by an unguessable filename — a mitigation,
 * not access control, since anyone holding a link could fetch one with no
 * session at all.
 *
 * This route is the gate. Authentication is the middleware's: everything under
 * /api/ that is not explicitly public gets a 401 without a session, so there is
 * none to repeat here — and repeating it would be worse than redundant, since
 * two implementations of the same rule is how one of them drifts.
 *
 * ## Visible to any signed-in member, deliberately
 *
 * Not scoped to whoever ran the test. The per-URL dashboard under Projects is
 * shared by design — that is the awareness layer FR-74 settled on, and it
 * already shows every monitor's results to the whole team. Scoping the images
 * to their owner would blank them on a screen that is meant to be shared, while
 * protecting nothing: the verdict they illustrate is right there beside them.
 *
 * ## Streamed, not redirected to a signed URL
 *
 * A short-lived signed URL would take the bytes off this process, which matters
 * on a container that also runs Chromium. It would also mean a fetchable link
 * existing outside the app, briefly, that could be copied out and shared.
 * Screenshots are opened rarely — only when a form's tab is expanded — so the
 * load is small and the safer shape is affordable. Worth revisiting only if
 * measurement says otherwise.
 */
export async function GET(_request: NextRequest, { params }: { params: { path?: string[] } }) {
  const path = (params.path ?? []).map((p) => decodeURIComponent(p)).join('/');

  /**
   * Re-validated here, not trusted from the caller.
   *
   * `shotSrc` builds these paths in the browser, which means the browser can
   * build any other path too. The same allowlist runs on both sides so neither
   * has to rely on the other, and the one that matters is this one: without it
   * a crafted key could walk out of the screenshot prefix and ask Storage for
   * something else the service-role key can read.
   */
  if (!isSafeShotPath(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!supabaseEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) {
    // A plain 404 either way. A missing object and an unreadable one are the
    // same thing to the reader, and distinguishing them would confirm which
    // keys exist to anyone probing.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/jpeg',
      /**
       * `private` so no shared cache keeps a copy: the response is only
       * authorised for the session that asked. Long-lived and immutable
       * because the object never changes — every run writes new random
       * filenames and clears the previous set, so a key identifies exactly one
       * image for as long as it exists.
       */
      'Cache-Control': 'private, max-age=86400, immutable',
      // It is somebody else's page in a picture; nothing here should ever be
      // interpreted as anything but an image.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
