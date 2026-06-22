'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// Human-readable messages for the ?error=... codes the OAuth callback sets.
const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: 'That Google account is not permitted. Please use an authorized company account.',
  email_unverified: 'Your Google email address is not verified.',
  state_mismatch: 'Your sign-in session expired. Please try again.',
  missing_code: 'Sign-in was interrupted. Please try again.',
  google_denied: 'Sign-in was cancelled.',
  google_error: 'Could not complete sign-in with Google. Please try again.',
};

// useSearchParams() requires a Suspense boundary during static prerender
// (Next.js App Router requirement). Extracted into a child component so we
// can wrap just the search-params-reading part with <Suspense>.
function LoginCard() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';
  const errorCode = searchParams.get('error');
  const error = errorCode ? ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.' : null;

  // Plain link — the OAuth flow is a full top-level navigation, not a fetch.
  const googleHref = `/api/auth/google?redirect=${encodeURIComponent(redirectTo)}`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <a
        href={googleHref}
        className="flex w-full items-center justify-center gap-3 rounded-lg bg-white hover:bg-slate-100 active:bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors shadow"
      >
        <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden>
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
          />
        </svg>
        Sign in with Google
      </a>

      <p className="text-center text-xs text-slate-600">
        Access is restricted to authorized company accounts.
      </p>
    </div>
  );
}

/** Minimal placeholder shown while the Suspense boundary is resolving. */
function LoginCardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 bg-slate-800 rounded-lg" />
      <div className="h-4 bg-slate-800/60 rounded w-2/3 mx-auto" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo + name */}
        <div className="flex flex-col items-center mb-8">
          {/* Brand mark — Form + Ping (same artwork as the favicon) */}
          <div className="rounded-xl shadow-lg shadow-indigo-900/50 mb-3">
            <svg width="48" height="48" viewBox="0 0 64 64" aria-hidden className="block">
              <defs>
                <linearGradient id="fpLoginMark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#6366f1" />
                  <stop offset="1" stopColor="#4338ca" />
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="14" fill="url(#fpLoginMark)" />
              <rect x="14" y="12" width="27" height="29" rx="5" fill="#ffffff" />
              <rect x="19" y="18.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
              <rect x="19" y="24.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
              <rect x="19" y="30.4" width="11" height="3.2" rx="1.6" fill="#c7d2fe" />
              <circle cx="45" cy="46" r="8" fill="none" stroke="#ff6a2b" strokeWidth="2.4" opacity="0.5" />
              <circle cx="45" cy="46" r="4.2" fill="#ff6a2b" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-100">FormPing</h1>
          <p className="text-xs text-slate-500 mt-1">Contact Form QA & Site Monitor</p>
        </div>

        {/* Sign-in card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/40">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Sign in to continue</h2>
          <Suspense fallback={<LoginCardSkeleton />}>
            <LoginCard />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Authorized testing only · Apexure internal tool
        </p>
      </div>
    </div>
  );
}
