import { Text, useTheme } from '@omniviewdev/kit';
import { useConnections } from '@omniviewdev/runtime/ui/v1';
import { useEffect, useState } from 'react';
import type { ContributionV1, SidebarContextV1, SidebarNodeV1 } from '../../contract/v1';
import { itemPage } from './detail';
import { createFixturePalette } from './palette';
import { streamsTool } from './panel';
import { crashPage, itemsPage } from './pages';

// A plugin's new-UI bundle, as small as one can be and still be the real thing: it exports `contributionV1` and nothing else is the host's business
// (`imports` below is for the check that reads it, not part of the contract). Its only imports are React and the kit, which the host serves.

// The entry that will have a count declares the slot with `null` (Q2a): the slot is held at the width of a count from the first frame, so the count that arrives moves nothing. `Crash` has no count and no slot.
// Both entries carry keywords (C1e): the other names their pages are known by, which the palette finds a page by (`stuff` and `inventory` are Items, `boom` and `bang` are Crash). Neither is a letter of its label, so
// a page found by one is found by the keyword and by nothing else. The skeleton and the nodes the hook answers say the same words, so the page is found by them before and after the hook answers.
const ITEMS_KEYWORDS: readonly string[] = ['stuff', 'inventory'];
const CRASH_KEYWORDS: readonly string[] = ['boom', 'bang'];

const SKELETON: readonly SidebarNodeV1[] = [
  {
    id: 'things',
    label: 'Things',
    icon: 'layers',
    children: [
      { id: 'items', label: 'Items', icon: 'box', count: null, keywords: ITEMS_KEYWORDS },
      { id: 'crash', label: 'Crash', icon: 'status-error', keywords: CRASH_KEYWORDS },
    ],
  },
];

// An estimate: "~5", named "about 5".
const WITH_COUNTS: readonly SidebarNodeV1[] = [
  {
    id: 'things',
    label: 'Things',
    icon: 'layers',
    children: [
      { id: 'items', label: 'Items', icon: 'box', count: { value: 5, approximate: true }, keywords: ITEMS_KEYWORDS },
      { id: 'crash', label: 'Crash', icon: 'status-error', keywords: CRASH_KEYWORDS },
    ],
  },
];

/**
 * What a plugin reads once it has data: here a timer stands for the read, and the skeleton stands until it fires. The groups the host says are open are what a real plugin would read counts for: the fixture
 * keeps the last list it was told in `window.__fixtureSidebar`, for the seam check to read (the check proves, in a real engine, that the host tells the hook which groups are open on screen).
 */
function useCounts({ open }: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Reflect.set(window, '__fixtureSidebar', { open });
  }, [open]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true);
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return ready ? WITH_COUNTS : undefined;
}

/** The entry this plugin has in the window's rail, its name and its place, and the label of its tool in the bottom panel: written into the bundle by the build (`build.mjs`, `define`), because the check installs two plugins from this one source. */
declare const FIXTURE_RAIL: { readonly label: string; readonly order: number; readonly tool: string };

/**
 * The name this plugin declares. The two copies declare one name, because they are one source and the checks that order a plugin's rows by their ids need rows that read alike. A check that asks for two names sets
 * `window.__fixtureOwnNames` before the bundle loads (the palette's twins, C1e) and gets the one each rail entry says, as two plugins have.
 */
const NAME = Reflect.get(window, '__fixtureOwnNames') === true ? FIXTURE_RAIL.label : 'Seam Fixture';

export const contributionV1 = {
  plugin: { name: NAME, accent: 'teal' },
  rail: { icon: 'layers', label: FIXTURE_RAIL.label, order: FIXTURE_RAIL.order },
  sidebar: { label: 'Seam Fixture navigation', title: 'Fixture', nodes: SKELETON, useNodes: useCounts },
  pages: { items: itemsPage, item: itemPage, crash: crashPage },
  home: 'items',
  panel: { tools: { streams: { ...streamsTool, label: FIXTURE_RAIL.tool } } },
  // Providers of results for the command palette (C1c). Quiet until a check asks for them (palette.ts): the other checks search for the host's pages and commands.
  palette: createFixturePalette(
    FIXTURE_RAIL.label,
    (name) => ({ page: 'item', params: { name } }),
    { page: 'items', params: {} },
  ),
} satisfies ContributionV1;

/** The shared modules as this bundle received them: the check compares them with the host's. */
export const imports = { useState, Text, useTheme, useConnections };
