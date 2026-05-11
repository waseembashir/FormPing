/**
 * Basic-auth gate for the entire app.
 *
 * Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD in ui/.env.local to enable.
 * If either is empty, the gate is OPEN (useful for local dev).
 *
 * Goes in front of every page and API route — anyone hitting any URL gets
 * a browser-native login popup. Without the right credentials they get a
 * 401 and never reach the actual handler.
 */
import { NextResponse, type NextRequest } from 'next/server';

const AUTH_USER = process.env['BASIC_AUTH_USER'] ?? '';
const AUTH_PASSWORD = process.env['BASIC_AUTH_PASSWORD'] ?? '';
const AUTH_ENABLED = AUTH_USER.length > 0 && AUTH_PASSWORD.length > 0;

export function middleware(req: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next();

  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const encoded = header.slice('Basic '.length).trim();
    let decoded = '';
    try {
      decoded = atob(encoded);
    } catch {
      /* malformed header */
    }
    const sep = decoded.indexOf(':');
    if (sep >= 0) {
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (user === AUTH_USER && pass === AUTH_PASSWORD) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="FormPing", charset="UTF-8"',
      'Content-Type': 'text/plain',
    },
  });
}

// Apply to everything except Next.js internals, static assets, and the
// health check (Railway / Docker orchestrators need to hit /api/health
// without supplying credentials).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
