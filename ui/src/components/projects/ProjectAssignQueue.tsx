'use client';

import { useState } from 'react';
import { AddToProjectModal } from './AddToProjectModal';

/**
 * Shows the "add to a project?" popup for a list of URLs, one at a time. Used
 * after a Form Tester / Change Monitor run to prompt for each tested URL that
 * isn't in a project yet. Each modal self-gates (skips silently if the URL is
 * already in a project or was dismissed), so already-grouped URLs fall through
 * without a flash.
 */
export function ProjectAssignQueue({ urls, onDone }: { urls: string[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const current = urls[i];
  if (!current) return null;

  return (
    <AddToProjectModal
      key={current}
      url={current}
      onClose={() => {
        if (i + 1 < urls.length) setI(i + 1);
        else onDone();
      }}
    />
  );
}
