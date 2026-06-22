/**
 * App-wide footer. Server component so the copyright year is evaluated at
 * render time on the server — it stays current automatically with no client
 * JS and no hydration mismatch.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-5 flex flex-col sm:flex-row items-center justify-between gap-1.5">
        <p className="text-xs text-slate-500">
          An <span className="font-semibold text-slate-300">Apexure</span> tool
        </p>
        <p className="text-xs text-slate-600">
          &copy; {year} Apexure. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
