import type { ContributionV1 } from '../../contract/v1';
import { contributionV1 as connections } from './entry-connections';
import { allPage, landingPage } from './landing-pages';

// The connections fixture's bundle with a landing (`fixture-f-conn` built with `{ landing: true }`, build.mjs; KL2): everything the connections fixture has, which is what a plugin that declares none is, and the pages the host opens the plugin at when
// no connection is named: the landing and a page of all its connections, both read in no connection. It is a bundle of its own, written only on request, so that no scenario of the seam that opens the connections fixture (rule R4's, Home's, the picker's) sees a plugin
// whose open means anything but what it meant: those scenarios hold the window's own choice, and this one holds the plugin's.

export const contributionV1 = {
  ...connections,
  pages: { ...connections.pages, landing: landingPage, all: allPage },
  landing: 'landing',
} satisfies ContributionV1;
