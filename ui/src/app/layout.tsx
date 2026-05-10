import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FormPing — Contact Form QA Tester',
  description: 'Authorized QA automation tool for verifying contact form submissions',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      {/* suppressHydrationWarning quiets dev-only mismatches from browser
          extensions (Grammarly, LastPass, Dark Reader, etc.) that inject
          attributes/divs into the DOM before React hydrates. Doesn't hide
          real bugs in the React tree itself. */}
      <body className="antialiased min-h-screen bg-slate-950" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
