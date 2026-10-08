/**
 * What the project pickers are allowed to be told.
 *
 * The "Use a project" dropdown on the tester tabs, and the assign-to-project
 * chooser, used to call GET /api/projects — the endpoint that draws the
 * Projects page. It answered with the full project objects and the picker used
 * three fields of them.
 *
 * Among the fields it did not use was `shareToken`: the unguessable token that
 * makes a client's status page readable WITHOUT a session. Every picker open
 * sent every live token for every client to the browser. Nobody was exposed —
 * the endpoint is behind the session gate — but a token that unlocks a page
 * without auth should travel when something needs it, and a dropdown never
 * did.
 *
 * So the test that matters here is not that the three wanted fields survive.
 * It is that nothing else does, including fields that do not exist yet. A
 * project gains a field one day; if the projection were written by deleting
 * known-bad keys instead of naming wanted ones, that new field would ship to
 * every picker and no test would notice.
 */

import { describe, it, expect } from 'vitest';
import { projectList, projectListItem } from '@/lib/projects/projectList';
import type { Project } from '@/lib/projects/types';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Acme',
    urls: ['https://acme.example.com/contact'],
    notes: 'Renewal due in March; billing contact is on leave.',
    contact: 'ops@acme.example.com',
    shareToken: 'tok_live_3f9a2b7c1d',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    createdBy: 'Avery Stone',
    updatedBy: 'Jordan Blake',
    ...over,
  };
}

describe('narrowing a project for a picker', () => {
  it('keeps exactly the three fields a picker renders, and no others', () => {
    // Spelled as the whole key set rather than a few `toBeUndefined` checks.
    // A field added to Project later shows up here as a failure instead of
    // shipping quietly to every dropdown in the app.
    expect(Object.keys(projectListItem(project())).sort()).toEqual(['id', 'name', 'urls']);
  });

  it('never carries the share token', () => {
    // The specific one this change exists for: it grants access to a client's
    // status page with no session at all.
    const item = projectListItem(project()) as Record<string, unknown>;
    expect(item.shareToken).toBeUndefined();
    expect(JSON.stringify(item)).not.toContain('tok_live_3f9a2b7c1d');
  });

  it('never carries the client notes or contact', () => {
    // Written about a client, for staff reading that client's page. A dropdown
    // showing a name has no use for either.
    const serialised = JSON.stringify(projectListItem(project()));
    expect(serialised).not.toContain('Renewal due');
    expect(serialised).not.toContain('ops@acme.example.com');
  });

  it('passes the three fields through untouched', () => {
    const urls = ['https://a.example.com/x', 'https://b.example.com/y'];
    expect(projectListItem(project({ id: 'p9', name: 'Zenith', urls }))).toEqual({
      id: 'p9',
      name: 'Zenith',
      urls,
    });
  });

  it('keeps a project with no URLs rather than dropping it', () => {
    // An empty project is still a real choice in the chooser — it is exactly
    // what you pick when adding the first URL to it.
    expect(projectList([project({ urls: [] })])).toHaveLength(1);
  });
});

describe('ordering the list', () => {
  it('sorts by name, ignoring case', () => {
    // Without the case-insensitive compare, "Zenith" sorts above "acme" and
    // the list looks broken to anyone scanning it for a name.
    const names = projectList([
      project({ id: '1', name: 'Zenith' }),
      project({ id: '2', name: 'acme' }),
      project({ id: '3', name: 'Mercury' }),
    ]).map((p) => p.name);

    expect(names).toEqual(['acme', 'Mercury', 'Zenith']);
  });

  it('shows every project, hiding none', () => {
    /**
     * The quiet failure this guards against. Projects is the shared record —
     * every project is visible to everybody, which is what lets you see a URL
     * is already covered before adding it again. If this list ever began
     * filtering (by owner, by health, by anything), a picker would silently
     * omit projects and the only symptom would be somebody creating a
     * duplicate.
     */
    const all = [
      project({ id: '1', name: 'One' }),
      project({ id: '2', name: 'Two' }),
      project({ id: '3', name: 'Three' }),
    ];
    expect(projectList(all).map((p) => p.id).sort()).toEqual(['1', '2', '3']);
  });

  it('returns an empty list for no projects, not a failure', () => {
    expect(projectList([])).toEqual([]);
  });
});
