import { Text, useTheme } from '@omniviewdev/kit';
import { useConnections, useResource } from '@omniviewdev/runtime/ui/v1';
import { useEffect, useState } from 'react';
import type { ContributionV1, SidebarNodeV1 } from '../../contract/v1';
import { itemPage } from './detail';
import { crashPage, itemsPage } from './pages';

// A plugin's new-UI bundle, as small as one can be and still be the real thing: it exports `contributionV1` and nothing else is the host's business
// (`imports` below is for the check that reads it, not part of the contract). Its only imports are React and the kit, which the host serves.

const SKELETON: readonly SidebarNodeV1[] = [
  {
    id: 'things',
    label: 'Things',
    icon: 'layers',
    children: [
      { id: 'items', label: 'Items', icon: 'box' },
      { id: 'crash', label: 'Crash', icon: 'status-error' },
    ],
  },
];

const WITH_COUNTS: readonly SidebarNodeV1[] = [
  {
    id: 'things',
    label: 'Things',
    icon: 'layers',
    children: [
      { id: 'items', label: 'Items', icon: 'box', count: 5 },
      { id: 'crash', label: 'Crash', icon: 'status-error' },
    ],
  },
];

/** What a plugin reads once it has data: here a timer stands for the read, and the skeleton stands until it fires. */
function useCounts(): readonly SidebarNodeV1[] | undefined {
  const [ready, setReady] = useState(false);
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

export const contributionV1 = {
  plugin: { name: 'Seam Fixture', accent: 'teal' },
  rail: true,
  sidebar: { label: 'Seam Fixture navigation', title: 'Fixture', nodes: SKELETON, useNodes: useCounts },
  pages: { items: itemsPage, item: itemPage, crash: crashPage },
  home: 'items',
} satisfies ContributionV1;

/** The shared modules as this bundle received them: the check compares them with the host's. */
export const imports = { useState, Text, useTheme, useConnections, useResource };
