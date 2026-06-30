'use client';

import { useState } from 'react';
import { ProjectChooser } from './ProjectChooser';

/**
 * "Assign to project" — push a single URL INTO a project. Opens a centered
 * MODAL (not a dropdown): the Unassigned bucket lives inside an overflow-hidden
 * table, which clipped the old absolute-positioned popover. A fixed overlay is
 * immune to ancestor clipping. The pick/create logic lives in ProjectChooser.
 */
export function AssignToProject({
  url,
  onAssigned,
  label = 'Assign to project',
}: {
  url: string;
  onAssigned: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-indigo-700/60 bg-indigo-600/10 px-2 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-600/20 transition-colors"
      >
        {label}
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-100">Assign to a project</h3>
            <p className="mt-1 font-mono text-xs text-slate-300 break-all">{url}</p>

            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
              <ProjectChooser
                url={url}
                onAssigned={() => {
                  setOpen(false);
                  onAssigned();
                }}
              />
            </div>

            <div className="mt-3 flex justify-end border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
