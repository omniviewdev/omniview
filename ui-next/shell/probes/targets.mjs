// What the shell probe measures, in the mock and in the shell, with the same names.
//
//   TARGETS  every region and part: a selector in the mock, a selector in the shell, and how the two rectangles are compared
//   STYLES   the computed style each target must have, equal in both
//
// The shell is built on purpose with fewer parts than the mock draws (slice 1a plan 1.2: no search field above
// the tree, no rail tools, no tab close, no scope menus, no panel toggle), so a target says what is comparable:
//   abs        x, y, width and height
//   x-w, x-w-h x and width (and height): a region whose top or height depends on what is above or inside it
//   y-h        top and height only
//   size       width and height
//   rel:<name> the rectangle relative to the top left of another target (a part inside a region), and its size
//   text       (a flag) a run of text: x, width and the vertical centre, not the height (an inline box's height is the engine's content area)
// `adjust` is a known, exact difference between the two (the shell's scope faces have no chevron: 12 px and a 4 px gap).
//
// The mock is opened on its one reference screen, which `packages/kit/probes/mock-screen.mjs` names (the mock's own words stay with the recordings of the mock);
// the shell is opened on the fixture (fixture.tsx, `?case=full`): the same frame with invented, neutral registrations. The probe names no plugin's screen.
import { MOCK_ENTRY, MOCK_GROUP } from '../../../packages/kit/probes/mock-screen.mjs';

const topRow = '[data-shell-region="topRow"]';
const tab = '[data-shell-part="tab"]';
const group = '[role="treeitem"][aria-level="1"]';
const entry = '[role="treeitem"][aria-level="2"]';
const face = (n) => `[data-shell-part="scopeFace"]:nth-child(${n})`;
const crumbs = '[data-shell-region="statusBar"] nav';

export const TARGETS = [
  { name: 'window', mock: '.app', shell: '[data-shell-part="window"]', cmp: 'abs' },
  { name: 'topRow', mock: '.topbar', shell: topRow, cmp: 'abs' },
  { name: 'safeArea', mock: '.topbar__safe', shell: '[data-shell-part="safeArea"]', cmp: 'abs' },
  { name: 'dot1', mock: '.topbar__dots > i:nth-child(1)', shell: `${topRow} [data-shell-part="safeArea"] span span:nth-child(1)`, cmp: 'abs' },
  { name: 'dot3', mock: '.topbar__dots > i:nth-child(3)', shell: `${topRow} [data-shell-part="safeArea"] span span:nth-child(3)`, cmp: 'abs' },
  { name: 'tab', mock: '.tab-item', shell: tab, cmp: 'abs' },
  { name: 'tabIcon', mock: '.tab__lead svg', shell: `${tab} svg`, cmp: 'rel:tab' },
  { name: 'tabTitle', mock: '.tab__head', shell: `${tab} [data-ov-variant]`, cmp: 'rel:tab', text: true },
  { name: 'rail', mock: '.frame__rail', shell: '[data-shell-part="rail"]', cmp: 'abs' },
  { name: 'sidebar', mock: '.frame__sidebar', shell: '[data-shell-region="sidebar"]', cmp: 'abs' },
  { name: 'sidebarHeader', mock: '.toolheader', shell: '[data-shell-part="sidebarHeader"]', cmp: 'abs' },
  { name: 'sidebarTitle', mock: '.toolheader__title', shell: '[data-shell-part="sidebarHeader"] h2', cmp: 'rel:sidebarHeader', text: true },
  { name: 'tree', mock: '.tree', shell: '[role="tree"]', cmp: 'x-w' },
  { name: 'rowGroup', mock: MOCK_GROUP, shell: group, cmp: 'x-w-h' },
  { name: 'groupIcon', mock: `${MOCK_GROUP} > .tree__icon svg`, shell: `${group} > :nth-child(1) svg`, cmp: 'rel:rowGroup' },
  { name: 'groupLabel', mock: `${MOCK_GROUP} > .tree__label`, shell: `${group} > :nth-child(2)`, cmp: 'rel:rowGroup' },
  { name: 'groupToggle', mock: `${MOCK_GROUP} > .tree__toggle`, shell: `${group} > :nth-child(3)`, cmp: 'rel:rowGroup' },
  { name: 'rowEntry', mock: MOCK_ENTRY, shell: entry, cmp: 'x-w-h' },
  { name: 'entryIcon', mock: `${MOCK_ENTRY} > .tree__icon svg`, shell: `${entry} > :nth-child(1) svg`, cmp: 'rel:rowEntry' },
  { name: 'entryLabel', mock: `${MOCK_ENTRY} > .tree__label`, shell: `${entry} > :nth-child(2)`, cmp: 'rel:rowEntry', keys: ['x', 'y', 'h'] },
  { name: 'entryCount', mock: `${MOCK_ENTRY} > .tree__count`, shell: `${entry} [data-ov-variant="caption"]`, cmp: 'rel:rowEntry', text: true },
  { name: 'island', mock: '.frame__island', shell: '[data-shell-region="island"]', cmp: 'abs' },
  { name: 'lane', mock: '.frame__lane', shell: '[data-shell-part="lane"]', cmp: 'abs' },
  { name: 'face1', mock: '.frame__lane button:nth-of-type(1)', shell: face(1), cmp: 'abs', adjust: { w: -16 } },
  { name: 'face1Icon', mock: '.frame__lane button:nth-of-type(1) > .ic:first-child svg', shell: `${face(1)} svg`, cmp: 'rel:face1' },
  { name: 'face1Label', mock: '.frame__lane button:nth-of-type(1) [data-scope-label]', shell: `${face(1)} [data-ov-variant]`, cmp: 'rel:face1', text: true },
  { name: 'face2', mock: '.frame__lane button:nth-of-type(2)', shell: face(2), cmp: 'abs', adjust: { x: -16, w: -16 } },
  { name: 'face2Icon', mock: '.frame__lane button:nth-of-type(2) > .ic:first-child svg', shell: `${face(2)} svg`, cmp: 'rel:face2' },
  { name: 'face2Label', mock: '.frame__lane button:nth-of-type(2) [data-scope-label]', shell: `${face(2)} [data-ov-variant]`, cmp: 'rel:face2', text: true },
  { name: 'page', mock: '.frame__page', shell: '[data-shell-part="page"]', cmp: 'abs' },
  { name: 'statusBar', mock: '.statusbar', shell: '[data-shell-region="statusBar"]', cmp: 'abs' },
  { name: 'path', mock: '.status-path', shell: crumbs, cmp: 'y-h' },
  { name: 'crumb1', mock: '.status-path > :nth-child(1)', shell: `${crumbs} li:nth-child(1) [data-ov-variant]`, cmp: 'rel:path', text: true },
  { name: 'chevron1', mock: '.status-path > :nth-child(2) svg', shell: `${crumbs} li:nth-child(1) svg`, cmp: 'rel:path' },
  { name: 'crumb2', mock: '.status-path > :nth-child(3)', shell: `${crumbs} li:nth-child(2) [data-ov-variant]`, cmp: 'rel:path', text: true },
  { name: 'chevron2', mock: '.status-path > :nth-child(4) svg', shell: `${crumbs} li:nth-child(2) svg`, cmp: 'rel:path' },
  { name: 'crumb3', mock: '.status-path > :nth-child(5)', shell: `${crumbs} li:nth-child(3) [data-ov-variant]`, cmp: 'rel:path', text: true },
];

const text = ['color', 'fontSize', 'fontWeight', 'lineHeight'];
const surface = ['backgroundColor', 'borderTopLeftRadius'];

/** Computed style that must be equal. `edge` is the colour of a 1 px edge: a border in the mock, an inset shadow in the shell. */
export const STYLES = [
  { name: 'window', props: ['backgroundColor'] },
  { name: 'topRow', props: ['backgroundColor'], sharedFill: true },
  { name: 'dot1', props: surface },
  { name: 'tab', props: [...surface, 'edge'] },
  { name: 'tabTitle', props: text },
  { name: 'sidebar', props: surface },
  { name: 'sidebarTitle', props: text },
  { name: 'rowGroup', props: surface },
  { name: 'rowEntry', props: surface },
  { name: 'groupLabel', props: text },
  { name: 'entryLabel', props: text },
  { name: 'entryCount', props: text },
  { name: 'groupIcon', props: ['color'], path: 'stroke' },
  { name: 'island', props: surface },
  { name: 'face1Label', props: text },
  { name: 'face2Label', props: text },
  { name: 'face1Icon', props: ['color'] },
  { name: 'statusBar', props: ['backgroundColor', 'color', 'fontSize', 'lineHeight'], sharedFill: true },
  { name: 'crumb1', props: text },
  { name: 'crumb3', props: text },
  { name: 'chevron1', props: [], path: 'stroke' },
];

/** The text sizes and densities the frame is read under: default, text size 125 (every size scales), compact density. */
export const CONTEXTS = {
  default: { textScale: null, density: null },
  scale125: { textScale: '125', density: null },
  compact: { textScale: null, density: 'compact' },
};

/** The kit's nine theme ids, and the value of the mock's `data-theme` for each (the default palette is the absence of the attribute). */
export const THEME_MAP = {
  void: null,
  dark: 'dark',
  light: 'light',
  obsidian: 'obsidian',
  carbon: 'carbon',
  'solarized-dark': 'solarized-dark',
  'solarized-light': 'solarized-light',
  'high-contrast-dark': 'hc-dark',
  'high-contrast-light': 'hc-light',
};

/** The parts whose paint depends on the pointer and the keyboard. `mockFill` is the element the mock paints the fill on, when it is not the one that takes the focus. */
export const STATE_TARGETS = [
  { name: 'rowGroup', mock: MOCK_GROUP, shell: group },
  { name: 'rowEntry', mock: MOCK_ENTRY, shell: entry },
  { name: 'tab', mock: '.tab-item > [role="tab"]', mockFill: '.tab-item', shell: `${tab} > [role="tab"]`, shellFill: tab },
];
