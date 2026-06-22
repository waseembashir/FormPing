import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Footer } from '@/components/Footer';

// Public base URL used to resolve absolute OG/Twitter image URLs. Defaults to the
// current Railway domain; override with NEXT_PUBLIC_SITE_URL after a domain change.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formping-production.up.railway.app';

const DESCRIPTION =
  'Automated contact-form testing, change detection, scheduled form checks, and uptime & SSL monitoring — with instant Slack alerts. An Apexure internal QA tool.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'FormPing — Contact Form QA & Site Monitor',
    template: '%s · FormPing',
  },
  description: DESCRIPTION,
  applicationName: 'FormPing',
  authors: [{ name: 'Apexure' }],
  keywords: [
    'contact form testing',
    'form QA',
    'form submission monitoring',
    'website change detection',
    'uptime monitoring',
    'SSL expiry monitoring',
    'Slack alerts',
    'Apexure',
  ],
  // Internal tool gated by Google login — keep it out of search engines, while
  // still allowing rich link unfurls in Slack/Teams (OG tags below).
  robots: { index: false, follow: false },
  // icon.svg / icon.png / apple-icon.png / opengraph-image.png / twitter-image.png
  // in src/app are picked up automatically by Next.js file conventions.
  openGraph: {
    type: 'website',
    siteName: 'FormPing',
    title: 'FormPing — Contact Form QA & Site Monitor',
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FormPing — Contact Form QA & Site Monitor',
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // Matches the app's slate-950 background — colors mobile browser chrome.
  themeColor: '#020617',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      {/* suppressHydrationWarning quiets dev-only mismatches from browser
          extensions (Grammarly, LastPass, Dark Reader, etc.) that inject
          attributes/divs into the DOM before React hydrates. Doesn't hide
          real bugs in the React tree itself. */}
      <body className="antialiased min-h-screen bg-slate-950 flex flex-col" suppressHydrationWarning>
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
