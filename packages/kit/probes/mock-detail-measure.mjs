// Measures the design mock's DETAIL PAGE: the REFERENCE the host's plugin-agnostic detail page (route with the object's identity, in-page tabs, an Overview made of
// typed sections) is compared with. The sibling of mock-page-measure.mjs (the list page and the page header); it reuses probe-lib.mjs unchanged.
//
//   1. Run:  node packages/kit/probes/mock-detail-measure.mjs
//      Without MOCK_URL the script serves the mock itself: a CommonJS copy of the mock's server.js with `root` set to MOCK_DIR (default: the lab's
//      app/OmniviewNativeLab/frontend/mock, tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0, tag spec-baseline-2026-11-16) on port 49473, as mock-strip-measure.mjs does.
//      With a server running already:  MOCK_URL=http://127.0.0.1:49555/ node packages/kit/probes/mock-detail-measure.mjs
//   2. The whole matrix takes about 2 minutes (one job per engine and viewport, one paint job per engine, four at a time).
//
// WebKit and Chromium (launched with --font-render-hinting=none through probe-lib's launch()), 1440 x 900 and 1280 x 800 (page container #mainscroll > .content 1117 and 957 px
// wide), default theme, text size and density, the font normalized as mock-measure.mjs does (--int-font-ui: Helvetica, Arial, sans-serif). EVERY case is a freshly loaded page.
//
// Cases (JSON keys):
//   detail    the real page `?page=shell/page-kit-detail&lab=1` (the Deployment cart-api, Overview tab, nothing opened), read after 3.5 s: the page header, the tab strip, the
//             body (status summary, the Details key-value card, three table cards, the aside: Usage, the empty Recent warnings, Labels).
//   sections  throwaway pages built with the mock's OWN helpers (H.card, H.kv, H.listrows, H.tabs, H.routeLink, H.btn, H.status) in the real page container: AWS.page(id, render,
//             { layout: 'document' }) opened with Shell.tabs.open, as mock-page-measure.mjs opens its own. Each content is wrapped like the real page, `<div class="stack">`; a case
//             that lives in the aside sits in a column of exactly 341.671875 px (`[data-probe-col]`, the aside's width at 1440 and at every viewport: at 1280 the real aside wraps
//             and is 957 wide, so a fixed column is the only way to get the same 341.67 there). Cases: tagsMany (the Labels card of k8s-resource.js, 12 tags, 6 visible, collapsed
//             `Show all 12`; then expanded `Show fewer`: prefix tagsOpen), tagsLong (a 140-character value clamped, a 45-character key whose value is a chip of its own, a tag
//             with no value, a 22-character key with a 30-character value), kv1 (H.kv columns 1 in the column: text, status, link, code, missing value, 90-character wrap, and a
//             code row with copy: true), kv3 (H.kv columns 3 in a Details card, full page width: 9 rows and one wide row), list (the Recent warnings card of warningsCard in the
//             column: 3 rows, the second with a clipped title and detail), tabsIcons (H.tabs with icons, a count and an id-only tab, at the page's top), links (routeLink, a mono
//             routeLink and a linkbtn).
//   paint     once per engine at 1440 x 900, the parts below in the states rest, hover (pointer on the centre) and focus (Shift pressed, then .focus() on the part or, when it is
//             no control, on its nearest button / link ancestor; a part with none has no focus state).
//
// NAMES (the contract with the host's probe). Absolute viewport CSS px, 0.01 precision: node = { r: [x, y, w, h], x?: text (<= 80 characters, only for leaf-ish elements: at most
// 4 descendant elements), n: element count (1 + every descendant, svg internals included) }; a node that does not exist is null.
//   detail    header breadcrumb crumb0..3 (the three a.link and the last span) chevron0..2 row tile title meta state stateIcon stateLabel facts fact0..3 factText0..3 slot commands cmd0..5
//             tabs tab0..4 tabCount1 tabIcon0..4 (the page has none: null) pair main aside summary summaryItem0..6 content (#mainscroll .content).
//             Cards: P = card0..3 (main column, in order: Details, Containers, Pods, Conditions) and side0..2 (aside: Usage, Recent warnings, Labels); per card PLane (.cardtitle) PHeading
//             (h3) PLead (.cardtitle__lead, null when the card has no meta) PMeta PActions (.cardtitle > .row) PBody (.pad or .tablewrap). card0: kv kvRow0..7 kvLabel0..7 kvValue0..7.
//             card1..3: PTable PThead PTh0.. PRow0..2 (the Containers and Conditions tables have two rows: PRow2 is absent there) PCell<row>_<col> (every td of the first rows). side2: side2Chips tag0..2 tagKey0..2 tagValue0..2. side1: side1Empty.
//   sections  per case, the same node shape. The first name of a case is its prefix P and every other name is P + the suffix with a capital:
//             tagsMany / tagsOpen (two prefixes in the case tagsMany; tagsOpen is the expanded page): P (card) PLane PHeading PMeta PLead PActions PBody PChips PToggle PTag<i> PTagKey<i>
//               PTagValue<i> PTagKeyHead<i> PTagKeyTail<i> (i = 0..5 collapsed: 6 visible; 0..11 expanded) (the two halves of a keyFace with a middle: null for a short key); tagsLong: the same with PTag0 PTag1a PTag1b PTag2 PTag3
//               (the 45-character key is the `i` of PTag1a, its value the `b` of PTag1b; PTag2 has no value: its `b` holds the key, PTag2Key is null); kv1 / kv3: P (the dl.kv) PCard
//               (the card) PRow0.. PLabel0.. PValue0.. (kv1: 7 rows, 0 text, 1 status, 2 link, 3 code, 4 missing, 5 wrap, 6 code with copy; kv3: 10 rows, the wide one is row 9);
//               list: list (card) listLane listAction listRows listRow0..2 listIcon0..2 listTitle0..2 listDetail0..2 listMeta0..2;
//               tabsIcons (no prefix): tabs tab0..2 tabIcon0..2 (tab 2 has none: null) tabCount1; links (no prefix): link0 link1 linkbtn0 para0..2.
//             Every aside case also has col (the 341.67 column) and page (the wrapping .stack).
//   paint     parts tabSelected tabUnselected tabCount cardHeading cardLane (its bottom border) cardMeta kvLabel kvValue summaryValueB summarySep tag tagKey tagValue link linkbtn
//             linkbtnShowAll listTitle listDetail listMeta, each { rest, hover?, focus? }; an entry is { m: { hover, focusVisible, focusTag }, color, backgroundColor, bT bR bB bL ('width
//             style colour', only a side that has a width), outline ('style width colour offset'), borderRadius, fontSize, fontWeight, lineHeight, fontFamily (the first family),
//             textDecorationLine, opacity, boxShadow, backgroundImage (only when not none) }.
//             WHERE each part is: tabSelected / tabUnselected (the second tab) / tabCount (its count) / cardHeading (card0 h3) / cardLane (card0 .cardtitle) / cardMeta (the Pods
//             .cardtitle__meta) / kvLabel + kvValue (the first dt and dd) / summaryValueB (.status-summary b) / summarySep / tag + tagKey + tagValue (the first Labels tag) / link
//             (the first a.link of the Details card: the Pods table has NO a.link, its first cell is a button.linkbtn) / linkbtn (the first .linkbtn of the Pods table) of the detail page;
//             linkbtnShowAll (`Show all 12`) of tagsMany; listTitle listDetail listMeta of the list case. cardLane's border is the bottom one (the 1px rule under the lane).
//
// Output mock-detail.json (at most 150 KB): { meta, detail, sections, paint, checks }
//   meta      mockTree, tag, measuredAt, engines (+ versions), viewports, font, engineDifferences (rect differences of more than 0.5 px, `case/viewport/name`), engineOtherDifferences
//             (the text, the element count, or a node that exists in one engine only), pageErrors (the mock's own console errors), failures, notes
//   detail    { <engine>: { <viewport>: { <name>: node } } }
//   sections  { <engine>: { <viewport>: { <case>: { <name>: node } } } }
//   paint     { <engine>: { <part>: { rest, hover?, focus? } } }
//   checks    { headerToTabsGap 12, tabFaceHeight 28, tabFaceGap 4, kvRowHeight 24, cardLaneHeight 29, cardGap 12, main1440 763.33, aside1440 341.67, asideWraps1440 false, main1280, aside1280,
//               asideWraps1280 (true: at 1280 the .readable-pair wraps, the aside is under the main column and as wide as it), sectionColumn 341.67 } each over every engine and viewport
//             it applies to; the script fails when one does not hold (`failures`).
// Engines: where Chromium differs from WebKit by at most 0.5 px (and in nothing else) the node is stored ONCE, under webkit. The chromium maps hold ONLY the nodes (and the paint parts)
// that differ; read a value with resolveNode(doc, 'detail', engine, viewport, name) / resolvePaint(doc, engine, part), exported here (the run starts only when this file is the entry).
// Debug: ENGINE=, VIEWPORT= (comma lists), ONLY=<regexp on a case id: detail tagsMany tagsOpen tagsLong kv1 kv3 list tabsIcons links paint> (writes mock-detail.partial.json instead),
// JOBS=<n> (default 4), MOCK_URL, MOCK_DIR.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, settle, sleep } from './probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const MOCK_TAG = 'spec-baseline-2026-11-16';
const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const engineFilter = process.env.ENGINE ? process.env.ENGINE.split(',') : Object.keys(ENGINES);
const viewportFilter = process.env.VIEWPORT ? process.env.VIEWPORT.split(',') : Object.keys(VIEWPORTS);
const JOBS = Math.max(1, Number(process.env.JOBS ?? 4));
const writeOut = !only && !process.env.ENGINE && !process.env.VIEWPORT;
const TOL = 0.5;
const MAX_BYTES = 150 * 1024;
const COLUMN = 341.671875;
const DETAIL_URL_PATH = '?page=shell/page-kit-detail&lab=1';
const wants = (id) => !only || only.test(id);

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The page side: these functions run in the browser and must not close over anything.                                              */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function installLib() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const nodeOf = (el) => {
    const b = el.getBoundingClientRect();
    const n = { r: [r2(b.left), r2(b.top), r2(b.width), r2(b.height)] };
    const inner = [...el.querySelectorAll('*')].filter((e) => !e.closest('svg') || e.tagName.toLowerCase() === 'svg').length;
    if (inner <= 4) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim() && !t.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      const parts = [];
      for (let t = walker.nextNode(); t; t = walker.nextNode()) parts.push(t.textContent);
      const x = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (x) n.x = x.length > 80 ? x.slice(0, 80) : x;
    }
    n.n = 1 + el.querySelectorAll('*').length;
    return n;
  };
  /** Read the defs: { n, root?, ri?, sel, k?, want?, all?, limit?, grid?, rows? }. Returns { rec: { name: node | null }, counts: { name: matches } }. */
  const read = (defs) => {
    const rec = {};
    const counts = {};
    for (const d of defs) {
      const base = d.root === undefined ? document : (document.querySelectorAll(d.root)[d.ri ?? 0] ?? null);
      if (!base) { if (d.all || d.grid) counts[d.n] = 0; else rec[d.n] = null; continue; }
      if (d.grid) {
        const rows = [...base.querySelectorAll(d.sel)].slice(0, d.rows);
        rows.forEach((tr, r) => [...tr.querySelectorAll(':scope > td')].forEach((td, c) => { rec[`${d.n}${r}_${c}`] = nodeOf(td); }));
        counts[d.n] = rows.length;
        continue;
      }
      if (d.all) {
        const els = [...base.querySelectorAll(d.sel)].slice(0, d.limit ?? 99);
        els.forEach((el, i) => { rec[`${d.n}${i}`] = nodeOf(el); });
        counts[d.n] = els.length;
        continue;
      }
      const el = d.sel === '' ? base : (base.querySelectorAll(d.sel)[d.k ?? 0] ?? null);
      rec[d.n] = el ? nodeOf(el) : null;
      if (d.want !== undefined) counts[d.n] = base.querySelectorAll(d.countSel ?? d.sel).length;
    }
    return { rec, counts };
  };
  /** The paint of an element: the computed style of the brief, compact. */
  const paint = (el, focusTarget) => {
    const cs = getComputedStyle(el);
    const out = {
      m: { hover: el.matches(':hover'), focusVisible: focusTarget ? focusTarget.matches(':focus-visible') : false, ...(focusTarget ? { focusTag: focusTarget.tagName.toLowerCase() } : {}) },
      color: cs.color, backgroundColor: cs.backgroundColor,
    };
    for (const [key, side] of [['bT', 'Top'], ['bR', 'Right'], ['bB', 'Bottom'], ['bL', 'Left']]) {
      if (parseFloat(cs[`border${side}Width`]) > 0) out[key] = `${cs[`border${side}Width`]} ${cs[`border${side}Style`]} ${cs[`border${side}Color`]}`;
    }
    out.outline = `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`;
    out.borderRadius = cs.borderTopLeftRadius === cs.borderBottomRightRadius ? cs.borderTopLeftRadius : `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`;
    out.fontSize = cs.fontSize;
    out.fontWeight = cs.fontWeight;
    out.lineHeight = cs.lineHeight;
    out.fontFamily = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    out.textDecorationLine = cs.textDecorationLine;
    out.opacity = cs.opacity;
    out.boxShadow = cs.boxShadow;
    if (cs.backgroundImage !== 'none') out.backgroundImage = cs.backgroundImage;
    return out;
  };
  window.__md = { read, paint };
}

/** The mock's own helpers, driven with the neutral inputs of the brief. Every fixture is html from H.* only (the tag markup is k8s-resource.js's, copied). */
function installFixtures(columnPx) {
  const esc = H.esc;
  /** A text of exactly n characters, built by repeating a seed. */
  const fit = (seed, n) => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
  const column = (html) => `<div class="stack" data-probe-page><div class="stack" data-probe-col style="width:${columnPx}px;flex:none">${html}</div></div>`;

  /* k8s-resource.js: keyFace, wholeText, tagPair, tagChip, tagsCard (without the protected values and the model context) */
  const LONG_KEY = 38;
  function keyFace(name) {
    if (name.length <= 12) return esc(name);
    const slash = name.lastIndexOf('/'), tail = Math.min(name.length - 1, 28, Math.max(6, slash < 0 ? Math.floor(name.length / 3) : name.length - slash - 1));
    return `<span class="pmid"><span class="pmid__head">${esc(name.slice(0, -tail))}</span><span class="pmid__tail">${esc(name.slice(-tail))}</span></span>`;
  }
  const wholeText = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
  const tagPair = (name, valueHtml, tip) => (name.length > LONG_KEY
    ? `<span class="tag"${H.tip(tip)}><i>${keyFace(name)}</i></span><span class="tag"${H.tip(tip)}><b>${valueHtml}</b></span>`
    : `<span class="tag"${H.tip(tip)}><i>${keyFace(name)}</i><b>${valueHtml}</b></span>`);
  function tagChip(item) {
    const name = String(item.key ?? ''), whole = item.value === undefined || item.value === null ? '' : String(item.value), flat = whole.replace(/\s+/g, ' ').trim();
    const tip = item.tip || (whole ? `${name} = ${wholeText(whole, 600)}` : name);
    return item.value === undefined ? `<span class="tag"${H.tip(tip)}><b>${keyFace(name)}</b></span>` : tagPair(name, esc(wholeText(flat, 400)), tip);
  }
  function tagsCard(items, open) {
    const visible = 6, total = items.length, shown = open || items.length <= visible ? items : items.slice(0, visible);
    const rows = `<div class="chips">${shown.map(tagChip).join('')}</div>`;
    const toggle = items.length > visible ? `<div>${H.btn(open ? 'Show fewer' : `Show all ${total}`, 'noop:disclosure', '', 'linkbtn', { expanded: open })}</div>` : '';
    const inspect = H.ibtn('LuPanelRightOpen', 'noop:inspect', 'Inspect labels', 'ghost small');
    return H.card(esc('Labels'), `<div class="stack">${rows}${toggle}</div>`, inspect, '', { pad: true, meta: esc(String(total)) });
  }
  const many = [
    { key: 'app', value: 'orders-api' }, { key: 'tier', value: 'backend' }, { key: 'example.io/managed-by', value: 'helm' },
    { key: 'environment', value: 'production' }, { key: 'component', value: 'checkout' }, { key: 'release', value: 'stable-2026' }, { key: 'version', value: 'v2.14.3' },
    { key: 'costcenter', value: 'cc-4412-eu' }, { key: 'ownership', value: 'platform-team' }, { key: 'region', value: 'eu-west-1b' }, { key: 'tracking', value: 'enabled' }, { key: 'rollout', value: 'blue-green' },
  ];
  const long = [
    { key: 'description', value: fit('Orders API checkout service handling cart reconciliation and payment capture. ', 140) },
    { key: fit('example.io/team.platform.checkout.reconciliation-owner', 45), value: 'v1' },
    { key: 'experimental-feature' },
    { key: fit('app.kubernetes.io/instance', 22), value: fit('orders-api-checkout-reconciliation', 30) },
  ];

  /* H.kv */
  const kv1Rows = () => [
    { label: 'Name', value: 'orders-api' },
    { label: 'State', kind: 'status', value: H.status('Running', 'Running', { role: 'running' }) },
    { label: 'Instance', kind: 'link', value: { text: 'orders-api', route: { page: 'ec2/instances' } } },
    { label: 'Command', kind: 'code', value: 'node server.js --port 8080' },
    { label: 'Region', value: '—' },
    { label: 'Description', value: fit('Handles cart reconciliation, payment capture and the nightly export to the data warehouse. ', 90) },
    { label: 'Digest', kind: 'code', value: 'sha256:9f2a41c7e0d3', copy: true },
  ];
  const kv3Rows = () => [
    { label: 'Name', value: 'cart-api' }, { label: 'Namespace', value: 'checkout' }, { label: 'Kind', value: 'Deployment' }, { label: 'Created', value: '2026-11-13 09:41 UTC' },
    { label: 'Strategy', value: 'RollingUpdate · surge 25%' }, { label: 'Revision', value: '14' }, { label: 'Replicas', value: '3 desired · 3 ready' }, { label: 'History limit', value: '10 revisions' },
    { label: 'Owner', value: 'platform-team' },
    { label: 'Description', value: fit('Handles cart reconciliation, payment capture and the nightly export to the data warehouse. ', 110), wide: true },
  ];

  /* warningsCard: the card, three list rows, the Events action */
  const warningsCard = () => {
    const rows = [
      { reason: 'BackOff', message: 'Back-off restarting failed container', at: '2m' },
      { reason: fit('ReadinessProbeFailedForContainerOrdersApiCheckoutWorker', 52), message: fit('Readiness probe failed: Get "http://10.4.2.17:8080/healthz": context deadline exceeded (Client.Timeout exceeded while awaiting headers). ', 110), at: '14m' },
      { reason: 'FailedScheduling', message: '0/6 nodes are available: 6 Insufficient cpu', at: '1h' },
    ];
    const list = H.listrows(rows.map((row) => H.listrow([esc(row.reason), esc(row.message)], { icon: H.status('Warning', 'Warning', { role: 'attention', variant: 'symbol' }), meta: esc(row.at), tip: `${row.reason}: ${row.message}` })), { label: 'Recent warnings' });
    return H.card('Recent warnings', list, H.btn('Events', 'noop:events', 'LuListChecks', 'ghost small'));
  };

  window.__fx = {
    tagsMany: (open) => column(tagsCard(many, !!open)),
    tagsLong: () => column(tagsCard(long, true)),
    kv1: () => column(H.card('Details', H.kv(kv1Rows(), { columns: 1 }), '', '', { pad: true })),
    kv3: () => `<div class="stack" data-probe-page>${H.card('Details', H.kv(kv3Rows(), { columns: 3 }), '', '', { pad: true })}</div>`,
    list: () => column(warningsCard()),
    tabsIcons: () => H.tabs([{ id: 'overview', icon: 'LuLayoutGrid' }, { id: 'pods', label: 'Parts', count: 12, icon: 'LuBox' }, { id: 'events' }], { current: 'pods', label: 'Item sections' }),
    links: () => `<div class="stack" data-probe-page><p>Runs on ${H.routeLink({ page: 'ec2/instances' }, 'orders-api')} in checkout.</p><p>Instance ${H.routeLink({ page: 'ec2/instances' }, 'i-0a1b2c3d4e5f', { mono: true })}.</p><p>${H.btn('Show all 12', 'noop:all', '', 'linkbtn')}</p></div>`,
    routeKnown: () => !!AWS.pages['ec2/instances'],
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The targets: { n: name, sel, root?, ri? (nth match of root), k? (nth match of sel), want? (exact match count), opt?, all?, limit?, min?, grid?, rows? }  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const one = (n, sel, o = {}) => ({ n, sel, ...o });
const nth = (prefix, count, root, sel, o = {}) => Array.from({ length: count }, (_, i) => ({ n: `${prefix}${i}`, root, sel, k: i, ...(i === 0 ? { want: count } : {}), ...o }));
const H_ = '#mainscroll .page-header';
const CRUMBS = `${H_} > .breadcrumb`;
const TABS = '#mainscroll .tabs';
const MAIN_CARD = '#mainscroll .readable-pair > .stack > .card';
const SIDE_CARD = '#mainscroll .readable-pair > aside > .card';

const cardParts = (P, root, ri, table) => [
  { n: P, root, ri, sel: '' },
  { n: `${P}Lane`, root, ri, sel: '.cardtitle' },
  { n: `${P}Heading`, root, ri, sel: 'h3' },
  { n: `${P}Lead`, root, ri, sel: '.cardtitle__lead', opt: true },
  { n: `${P}Meta`, root, ri, sel: '.cardtitle__meta', opt: true },
  { n: `${P}Actions`, root, ri, sel: ':scope > .cardtitle > .row', opt: true },
  { n: `${P}Body`, root, ri, sel: ':scope > :is(.pad, .tablewrap)' },
  ...(table ? [
    { n: `${P}Table`, root, ri, sel: 'table.fit' },
    { n: `${P}Thead`, root, ri, sel: 'thead' },
    { n: `${P}Th`, root, ri, sel: 'th', all: true, limit: 12, min: 2 },
    { n: `${P}Row`, root, ri, sel: 'tbody tr', all: true, limit: 3, min: 2 },
    { n: `${P}Cell`, root, ri, sel: 'tbody tr', grid: true, rows: 3, min: 2 },
  ] : []),
];

const DETAIL_SPECS = [
  one('content', '#mainscroll .content'),
  one('header', H_), one('breadcrumb', `${H_} > .breadcrumb`),
  ...nth('crumb', 4, CRUMBS, ':scope > :is(a.link, span:not(.ic))'),
  ...nth('chevron', 3, CRUMBS, ':scope > .ic--12'),
  one('row', `${H_} > .page-header__row`), one('tile', `${H_} > .page-header__row > .tile`), one('title', `${H_} .page-header__title`),
  one('meta', `${H_} .page-header__meta`), one('state', `${H_} .page-header__meta > .resource-state`),
  one('stateIcon', '.resource-state__icon', { root: `${H_} .page-header__meta > .resource-state` }), one('stateLabel', '.resource-state__label', { root: `${H_} .page-header__meta > .resource-state` }),
  one('facts', `${H_} .page-header__facts`),
  ...nth('fact', 4, `${H_} .page-header__facts`, '.page-header__fact'),
  ...nth('factText', 4, `${H_} .page-header__facts`, '.page-header__fact-text'),
  one('slot', `${H_} .page-header__slot`), one('commands', `${H_} .page-header__commands`),
  ...nth('cmd', 6, `${H_} .page-header__commands`, ':scope > button'),
  one('tabs', TABS),
  ...nth('tab', 5, TABS, ':scope > button'),
  one('tabCount1', ':scope > button:nth-child(2) .count', { root: TABS }),
  ...[0, 1, 2, 3, 4].map((i) => one(`tabIcon${i}`, `:scope > button:nth-child(${i + 1}) .ic`, { root: TABS, opt: true })),
  one('pair', '#mainscroll .readable-pair'), one('main', '#mainscroll .readable-pair > .stack'), one('aside', '#mainscroll .readable-pair > aside'),
  one('summary', '#mainscroll .status-summary'),
  ...nth('summaryItem', 7, '#mainscroll .status-summary', ':scope > *'),
  ...[0, 1, 2, 3].flatMap((i) => cardParts(`card${i}`, MAIN_CARD, i, i > 0)),
  ...[0, 1, 2].flatMap((i) => cardParts(`side${i}`, SIDE_CARD, i, false)),
  one('kv', 'dl.kv', { root: MAIN_CARD, ri: 0 }),
  ...nth('kvRow', 8, '#mainscroll .readable-pair > .stack > .card dl.kv', '.kv__row'),
  ...nth('kvLabel', 8, '#mainscroll .readable-pair > .stack > .card dl.kv', 'dt'),
  ...nth('kvValue', 8, '#mainscroll .readable-pair > .stack > .card dl.kv', 'dd'),
  one('side1Empty', '.empty-line', { root: SIDE_CARD, ri: 1 }),
  one('side2Chips', '.chips', { root: SIDE_CARD, ri: 2 }),
  ...nth('tag', 3, SIDE_CARD, '.chips > .tag', { ri: 2 }),
  ...nth('tagKey', 3, SIDE_CARD, '.chips > .tag > i', { ri: 2 }),
  ...nth('tagValue', 3, SIDE_CARD, '.chips > .tag > b', { ri: 2 }),
];
const CARD = '#mainscroll [data-probe-page] .card';
const COL = '#mainscroll [data-probe-col]';
const PAGE = '#mainscroll [data-probe-page]';

const tagSpecs = (P, count, toggle = true) => [
  one(P, CARD), one(`${P}Lane`, '.cardtitle', { root: CARD }), one(`${P}Heading`, 'h3', { root: CARD }), one(`${P}Meta`, '.cardtitle__meta', { root: CARD }),
  one(`${P}Lead`, '.cardtitle__lead', { root: CARD }), one(`${P}Actions`, ':scope > .cardtitle > .row', { root: CARD }), one(`${P}Body`, ':scope > .pad', { root: CARD }),
  one(`${P}Chips`, '.chips', { root: CARD }), one(`${P}Toggle`, '.linkbtn', { root: CARD, opt: !toggle }),
  one('col', COL), one('page', PAGE),
  ...Array.from({ length: count }, (_, i) => [
    one(`${P}Tag${i}`, `.chips > .tag:nth-child(${i + 1})`, { root: CARD, ...(i === 0 ? { want: count, countSel: '.chips > .tag' } : {}) }),
    one(`${P}TagKey${i}`, `.chips > .tag:nth-child(${i + 1}) > i`, { root: CARD, opt: true }),
    one(`${P}TagValue${i}`, `.chips > .tag:nth-child(${i + 1}) > b`, { root: CARD, opt: true }),
    one(`${P}TagKeyHead${i}`, `.chips > .tag:nth-child(${i + 1}) .pmid__head`, { root: CARD, opt: true }),
    one(`${P}TagKeyTail${i}`, `.chips > .tag:nth-child(${i + 1}) .pmid__tail`, { root: CARD, opt: true }),
  ]).flat(),
];
const tagsLongSpecs = () => {
  const P = 'tagsLong';
  const base = tagSpecs(P, 0, false);
  const names = [['0', 1, true, true], ['1a', 2, true, false], ['1b', 3, false, true], ['2', 4, false, true], ['3', 5, true, true]];
  const items = names.flatMap(([name, child, key, value], i) => [
    one(`${P}Tag${name}`, `.chips > .tag:nth-child(${child})`, { root: CARD, ...(i === 0 ? { want: 5, countSel: '.chips > .tag' } : {}) }),
    one(`${P}Tag${name}Key`, `.chips > .tag:nth-child(${child}) > i`, { root: CARD, opt: !key }),
    one(`${P}Tag${name}Value`, `.chips > .tag:nth-child(${child}) > b`, { root: CARD, opt: !value }),
    one(`${P}Tag${name}KeyHead`, `.chips > .tag:nth-child(${child}) .pmid__head`, { root: CARD, opt: true }),
    one(`${P}Tag${name}KeyTail`, `.chips > .tag:nth-child(${child}) .pmid__tail`, { root: CARD, opt: true }),
  ]);
  return [...base, ...items];
};
const kvSpecs = (P, rows, column) => [
  one(`${P}Card`, CARD), one(P, 'dl.kv', { root: CARD }),
  ...(column ? [one('col', COL)] : []), one('page', PAGE),
  ...nth(`${P}Row`, rows, `${CARD} dl.kv`, '.kv__row'), ...nth(`${P}Label`, rows, `${CARD} dl.kv`, 'dt'), ...nth(`${P}Value`, rows, `${CARD} dl.kv`, 'dd'),
];
const LIST_SPECS = [
  one('list', CARD), one('listLane', '.cardtitle', { root: CARD }), one('listAction', '.cardtitle .row > button', { root: CARD }), one('listRows', '.listrows', { root: CARD }),
  one('col', COL), one('page', PAGE),
  ...[0, 1, 2].flatMap((i) => [
    one(`listRow${i}`, `.listrows > .listrow:nth-child(${i + 1})`, { root: CARD, ...(i === 0 ? { want: 3, countSel: '.listrows > .listrow' } : {}) }),
    one(`listIcon${i}`, `.listrows > .listrow:nth-child(${i + 1}) .listrow__icon`, { root: CARD }),
    one(`listTitle${i}`, `.listrows > .listrow:nth-child(${i + 1}) .listrow__text > span`, { root: CARD }),
    one(`listDetail${i}`, `.listrows > .listrow:nth-child(${i + 1}) .listrow__text > small`, { root: CARD }),
    one(`listMeta${i}`, `.listrows > .listrow:nth-child(${i + 1}) .listrow__meta`, { root: CARD }),
  ]),
];
const TABS_SPECS = [
  one('tabs', TABS),
  ...nth('tab', 3, TABS, ':scope > button'),
  ...[0, 1, 2].map((i) => one(`tabIcon${i}`, `:scope > button:nth-child(${i + 1}) .ic`, { root: TABS, opt: i === 2 })),
  one('tabCount1', ':scope > button:nth-child(2) .count', { root: TABS }),
];
const LINKS_SPECS = [
  one('page', PAGE), one('link0', 'a.link:not(.mono)', { root: PAGE }), one('link1', 'a.link.mono', { root: PAGE }), one('linkbtn0', '.linkbtn', { root: PAGE }),
  ...nth('para', 3, PAGE, 'p'),
];

/** [case id, fixture kind, fixture argument, specs, ready selector]. */
const SECTION_CASES = [
  { id: 'tagsMany', kind: 'tagsMany', arg: false, specs: tagSpecs('tagsMany', 6), ready: `${CARD} .chips`, wrap: true },
  { id: 'tagsOpen', kind: 'tagsMany', arg: true, specs: tagSpecs('tagsOpen', 12), ready: `${CARD} .chips`, into: 'tagsMany', wrap: true },
  { id: 'tagsLong', kind: 'tagsLong', specs: tagsLongSpecs(), ready: `${CARD} .chips`, wrap: true },
  { id: 'kv1', kind: 'kv1', specs: kvSpecs('kv1', 7, true), ready: `${CARD} dl.kv`, wrap: true },
  { id: 'kv3', kind: 'kv3', specs: kvSpecs('kv3', 10, false), ready: `${CARD} dl.kv`, wrap: true },
  { id: 'list', kind: 'list', specs: LIST_SPECS, ready: `${CARD} .listrows`, wrap: true },
  { id: 'tabsIcons', kind: 'tabsIcons', specs: TABS_SPECS, ready: TABS },
  { id: 'links', kind: 'links', specs: LINKS_SPECS, ready: `${PAGE} p` },
];

/** The parts of the paint: the page they are on, the element, and the lane they are asked about. */
const PAINT_PARTS = [
  ['tabSelected', 'detail', `${TABS} > button.active`],
  ['tabUnselected', 'detail', `${TABS} > button:nth-child(2)`],
  ['tabCount', 'detail', `${TABS} > button:nth-child(2) .count`],
  ['cardHeading', 'detail', `${MAIN_CARD} h3`],
  ['cardLane', 'detail', `${MAIN_CARD} .cardtitle`],
  ['cardMeta', 'detail', '#mainscroll .cardtitle__meta'],
  ['kvLabel', 'detail', '#mainscroll dl.kv dt'],
  ['kvValue', 'detail', '#mainscroll dl.kv dd'],
  ['summaryValueB', 'detail', '#mainscroll .status-summary b'],
  ['summarySep', 'detail', '#mainscroll .status-summary__sep'],
  ['tag', 'detail', '#mainscroll .chips .tag'],
  ['tagKey', 'detail', '#mainscroll .chips .tag > i'],
  ['tagValue', 'detail', '#mainscroll .chips .tag > b'],
  ['link', 'detail', '#mainscroll dl.kv a.link'],
  ['linkbtn', 'detail', '#mainscroll .tablewrap .linkbtn'],
  ['linkbtnShowAll', 'tagsMany', `${CARD} .linkbtn`],
  ['listTitle', 'list', `${CARD} .listrow__text > span`],
  ['listDetail', 'list', `${CARD} .listrow__text > small`],
  ['listMeta', 'list', `${CARD} .listrow__meta`],
];

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Measuring (Node).                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const failures = [];
const pageErrors = {};
const fail = (label, message) => failures.push(`${label}: ${message}`);
const started = Date.now();

let server = null;
let URL_ = process.env.MOCK_URL;
async function serveMock() {
  if (URL_ !== undefined) return;
  // No MOCK_URL: a CommonJS copy of the mock's server.js with `root` set to the mock directory, on a free port.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-detail-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49473' }, stdio: 'ignore' });
  URL_ = 'http://127.0.0.1:49473/';
  await sleep(1500);
}

async function loadMock(browser, viewport, label, search) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = (pageErrors[label] ??= []);
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 120)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 120)}`); });
  await page.goto(`${URL_}${search}`, { waitUntil: 'load' });
  await sleep(search ? 3500 : 3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof window.AWS === 'object' && typeof window.Shell === 'object' && typeof window.__mock === 'object');
  if (!ok) throw new Error('mock did not expose H / AWS / Shell / __mock');
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  const root = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), scale: document.documentElement.getAttribute('data-text-scale'), density: document.documentElement.getAttribute('data-density') }));
  if (root.theme || root.scale || root.density) throw new Error(`the mock did not load in its defaults: ${JSON.stringify(root)}`);
  await page.evaluate(installLib);
  return { page, context };
}

/** Register a throwaway page (the mock's own AWS.page) whose body is window.__fx[kind](arg), open it in the tab, and wait for `ready`. */
async function openStage(page, { kind, arg, ready }) {
  await page.evaluate(installFixtures, COLUMN);
  await page.evaluate(({ kind, arg }) => {
    window.__probeBuild = () => window.__fx[kind](arg);
    AWS.page('probe/stage', () => window.__probeBuild(), { layout: 'document', reuse: true });
    Shell.tabs.open({ page: 'probe/stage' }, { how: 'here' });
  }, { kind, arg });
  await page.waitForSelector(ready, { state: 'attached', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await sleep(500);
  await settle(page);
}

/** Read targets and say which are missing (or present where they must not be). */
async function readSpecs(page, specs, label) {
  const { rec, counts } = await page.evaluate((s) => window.__md.read(s), specs);
  for (const spec of specs) {
    if (spec.all || spec.grid) {
      const got = counts[spec.n] ?? 0;
      if (got < (spec.min ?? 1)) fail(label, `target "${spec.n}" (${spec.sel}): expected at least ${spec.min ?? 1}, found ${got}`);
    } else {
      if (rec[spec.n] === null && !spec.opt) fail(label, `target "${spec.n}" (${spec.root ? `${spec.root} ` : ''}${spec.sel || 'the root'}) is missing`);
      if (spec.want !== undefined && counts[spec.n] !== spec.want) fail(label, `target "${spec.n}" (${spec.sel}): expected ${spec.want} matches of ${spec.countSel ?? spec.sel}, found ${counts[spec.n]}`);
    }
  }
  return rec;
}

async function detailCase(browser, vpName, viewport, label) {
  const { page, context } = await loadMock(browser, viewport, label, DETAIL_URL_PATH);
  try { return await readSpecs(page, DETAIL_SPECS, label); } finally { await context.close(); }
}

async function sectionCase(browser, vpName, viewport, c, label) {
  const { page, context } = await loadMock(browser, viewport, label, '');
  try {
    if ((c.kind === 'links' || c.kind === 'kv1') && !(await page.evaluate(() => AWS.pages['ec2/instances'] !== undefined))) fail(label, 'the page ec2/instances is not registered: routeLink would not draw an a.link');
    await openStage(page, { kind: c.kind, arg: c.arg, ready: c.ready });
    return await readSpecs(page, c.specs, label);
  } finally { await context.close(); }
}

/** The paint of one part in rest, hover and focus. */
async function paintPart(page, sel, label) {
  const handle = await page.$(sel);
  if (handle === null) { fail(label, `paint part ${sel} is missing`); return null; }
  const out = {};
  const away = async () => {
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
    await page.mouse.move(1, 1);
    await sleep(250);
    await settle(page);
  };
  await away();
  out.rest = await handle.evaluate((el) => window.__md.paint(el, null));
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await sleep(250);
  await settle(page);
  out.hover = await handle.evaluate((el) => window.__md.paint(el, null));
  await away();
  await page.keyboard.press('Shift');
  const focused = await handle.evaluate((el) => {
    const target = el.closest('button, a[href]');
    if (!target) return false;
    target.focus();
    return true;
  });
  if (focused) {
    await sleep(250);
    await settle(page);
    out.focus = await handle.evaluate((el) => window.__md.paint(el, el.closest('button, a[href]')));
    if (!out.focus.m.focusVisible) fail(label, `paint part ${sel}: the focus is not :focus-visible after Shift + .focus()`);
  }
  await away();
  return out;
}

async function paintJob(browser, engineName, label) {
  const out = {};
  const byPage = {};
  for (const [part, pageId, sel] of PAINT_PARTS) (byPage[pageId] ??= []).push([part, sel]);
  for (const [pageId, parts] of Object.entries(byPage)) {
    if (only && !only.test(pageId) && !only.test('paint')) continue;
    const { page, context } = pageId === 'detail' ? await loadMock(browser, VIEWPORTS['1440x900'], label, DETAIL_URL_PATH) : await loadMock(browser, VIEWPORTS['1440x900'], label, '');
    try {
      if (pageId !== 'detail') {
        const c = SECTION_CASES.find((x) => x.id === pageId);
        await openStage(page, { kind: c.kind, arg: c.arg, ready: c.ready });
      }
      for (const [part, sel] of parts) out[part] = await paintPart(page, sel, `${label}/${part}`);
    } finally { await context.close(); }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The run.                                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const raw = { detail: {}, sections: {}, paint: {} }; // detail[engine][vp], sections[engine][vp][case], paint[engine]
const versions = {};

async function job(engineName, vpName, kind) {
  const browser = await launch(engineName);
  versions[engineName] = browser.version();
  try {
    if (kind === 'paint') {
      const label = `paint/${engineName}`;
      raw.paint[engineName] = await paintJob(browser, engineName, label);
      console.log('done', label);
      return;
    }
    const viewport = VIEWPORTS[vpName];
    if (wants('detail')) {
      ((raw.detail[engineName] ??= {})[vpName]) = await detailCase(browser, vpName, viewport, `detail/${engineName}/${vpName}`);
      console.log('done', `detail/${engineName}/${vpName}`);
    }
    for (const c of SECTION_CASES) {
      if (!wants(c.id)) continue;
      const label = `${c.id}/${engineName}/${vpName}`;
      const rec = await sectionCase(browser, vpName, viewport, c, label);
      const target = (((raw.sections[engineName] ??= {})[vpName] ??= {})[c.into ?? c.id] ??= {});
      Object.assign(target, rec);
      console.log('done', label);
    }
  } finally { await browser.close(); }
}

/* ---- reducing: where Chromium is within TOL of WebKit the node is stored once ---- */

const sameNode = (a, b) => (a === null || b === null ? a === b : a.r.every((v, i) => Math.abs(v - b.r[i]) <= TOL) && a.x === b.x && a.n === b.n);
const rectDiffers = (a, b) => a !== null && b !== null && !a.r.every((v, i) => Math.abs(v - b.r[i]) <= TOL);
const engineDifferences = [];
const engineOtherDifferences = [];

function reduceMap(webkit, chromium, where) {
  if (!webkit || !chromium) return chromium;
  const diff = {};
  for (const name of new Set([...Object.keys(webkit), ...Object.keys(chromium)])) {
    const a = webkit[name] ?? null;
    const b = chromium[name] ?? null;
    if (sameNode(a, b)) continue;
    diff[name] = b;
    if (rectDiffers(a, b)) engineDifferences.push(`${where}/${name}: webkit ${JSON.stringify(a.r)} chromium ${JSON.stringify(b.r)}`);
    else engineOtherDifferences.push(`${where}/${name}: webkit ${JSON.stringify(a)} chromium ${JSON.stringify(b)}`);
  }
  return diff;
}

function reduceAll() {
  const out = { detail: {}, sections: {}, paint: {} };
  const both = engineFilter.includes('webkit') && engineFilter.includes('chromium');
  for (const engine of Object.keys(raw.detail)) {
    out.detail[engine] = {};
    for (const vp of Object.keys(raw.detail[engine])) {
      out.detail[engine][vp] = engine === 'chromium' && both ? reduceMap(raw.detail.webkit?.[vp], raw.detail.chromium[vp], `detail/${vp}`) : raw.detail[engine][vp];
    }
  }
  for (const engine of Object.keys(raw.sections)) {
    out.sections[engine] = {};
    for (const vp of Object.keys(raw.sections[engine])) {
      out.sections[engine][vp] = {};
      for (const id of Object.keys(raw.sections[engine][vp])) {
        const rec = raw.sections[engine][vp][id];
        out.sections[engine][vp][id] = engine === 'chromium' && both ? reduceMap(raw.sections.webkit?.[vp]?.[id], rec, `sections/${vp}/${id}`) : rec;
      }
    }
  }
  for (const engine of Object.keys(raw.paint)) {
    out.paint[engine] = {};
    for (const [part, states] of Object.entries(raw.paint[engine])) {
      const ref = raw.paint.webkit?.[part];
      if (engine === 'chromium' && both && ref && JSON.stringify(ref) === JSON.stringify(states)) continue;
      out.paint[engine][part] = states;
    }
  }
  return out;
}

/** A node as the named engine measured it: chromium holds only its differences. */
export function resolveNode(doc, section, engine, viewport, name, caseId) {
  const pick = (e) => (caseId === undefined ? doc[section]?.[e]?.[viewport] : doc[section]?.[e]?.[viewport]?.[caseId]);
  const own = pick(engine);
  if (own && name in own) return own[name];
  return pick('webkit')?.[name] ?? null;
}
export function resolvePaint(doc, engine, part) {
  return doc.paint?.[engine]?.[part] ?? doc.paint?.webkit?.[part] ?? null;
}

/* ---- the facts the page must reproduce ---- */

const near = (a, b, tol = 0.011) => typeof a === 'number' && Math.abs(a - b) <= tol;

function runChecks() {
  const checks = {};
  const record = (name, value, expected, ok) => {
    const prior = checks[name];
    checks[name] = prior === undefined ? value : (JSON.stringify(prior) === JSON.stringify(value) ? prior : `${prior} / ${value}`);
    if (!ok) fail('checks', `${name}: ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}`);
  };
  const wk = (engine, vp) => raw.detail[engine]?.[vp];
  for (const engine of Object.keys(raw.detail)) {
    for (const vp of Object.keys(raw.detail[engine])) {
      const d = wk(engine, vp);
      const bottom = (n) => (d[n] ? d[n].r[1] + d[n].r[3] : NaN);
      if (d.header && d.tabs) { const gap = Math.round((d.tabs.r[1] - bottom('header')) * 100) / 100; record('headerToTabsGap', gap, 12, gap === 12); }
      const faces = [0, 1, 2, 3, 4].map((i) => d[`tab${i}`]);
      if (faces.every(Boolean)) {
        const heights = [...new Set(faces.map((f) => f.r[3]))];
        record('tabFaceHeight', heights.length === 1 ? heights[0] : heights.join('/'), 28, heights.length === 1 && heights[0] === 28);
        const gaps = faces.slice(1).map((f, i) => Math.round((f.r[0] - faces[i].r[0] - faces[i].r[2]) * 100) / 100);
        const g = [...new Set(gaps.map((v) => (Math.abs(v - 4) <= 0.011 ? 4 : v)))];
        record('tabFaceGap', g.length === 1 ? g[0] : g.join('/'), 4, g.length === 1 && g[0] === 4);
      }
      if (d.kvRow0) record('kvRowHeight', d.kvRow0.r[3], 24, d.kvRow0.r[3] === 24);
      const lanes = [...[0, 1, 2, 3].map((i) => d[`card${i}Lane`]), ...[0, 1, 2].map((i) => d[`side${i}Lane`])];
      if (lanes.every(Boolean)) {
        const hs = [...new Set(lanes.map((l) => l.r[3]))];
        record('cardLaneHeight', hs.length === 1 ? hs[0] : hs.join('/'), 29, hs.length === 1 && hs[0] === 29);
      }
      const gapsOf = (names) => names.slice(1).map((n, i) => (d[n] && d[names[i]] ? Math.round((d[n].r[1] - bottom(names[i])) * 100) / 100 : NaN));
      const cg = [...gapsOf(['card0', 'card1', 'card2', 'card3']), ...gapsOf(['side0', 'side1', 'side2'])];
      record('cardGap', [...new Set(cg)].length === 1 ? cg[0] : [...new Set(cg)].join('/'), 12, cg.every((v) => v === 12));
      if (d.main && d.aside) {
        const wraps = d.aside.r[1] >= bottom('main') - TOL;
        const w = vp === '1440x900' ? '1440' : '1280';
        record(`main${w}`, d.main.r[2], vp === '1440x900' ? 763.33 : d.aside.r[2], vp === '1440x900' ? near(d.main.r[2], 763.33) : d.main.r[2] === d.aside.r[2]);
        record(`aside${w}`, d.aside.r[2], vp === '1440x900' ? 341.67 : d.main.r[2], vp === '1440x900' ? near(d.aside.r[2], 341.67) : d.main.r[2] === d.aside.r[2]);
        record(`asideWraps${w}`, wraps, vp === '1440x900' ? false : true, vp === '1440x900' ? !wraps : wraps);
      }
    }
  }
  for (const engine of Object.keys(raw.sections)) {
    for (const vp of Object.keys(raw.sections[engine])) {
      for (const id of ['tagsMany', 'tagsLong', 'kv1', 'list']) {
        const col = raw.sections[engine][vp][id]?.col;
        if (col) record('sectionColumn', col.r[2], 341.67, near(col.r[2], 341.67));
      }
    }
  }
  return checks;
}

/* ---- report ---- */

async function main() {
  await serveMock();
  const cases = [];
  for (const engine of engineFilter) {
    for (const vp of viewportFilter) if (wants('detail') || SECTION_CASES.some((c) => wants(c.id))) cases.push([engine, vp, 'cases']);
    if (wants('paint') || PAINT_PARTS.some(([, pageId]) => wants(pageId))) cases.push([engine, '1440x900', 'paint']);
  }
  const queue = [...cases];
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) {
      const [engine, vp, kind] = queue.shift();
      try { await job(engine, vp, kind); } catch (e) { errors.push(`${kind}/${engine}/${vp}: ${e.message}`); fail(`${kind}/${engine}/${vp}`, e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)); }
    }
  }));
  server?.kill();

  const checks = writeOut || (raw.detail.webkit && raw.detail.chromium) ? runChecks() : {};
  const reduced = reduceAll();
  const doc = {
    meta: {
      mockTree: MOCK_TREE, tag: MOCK_TAG, measuredAt: new Date().toISOString(),
      engines: Object.keys(versions).sort(), versions, viewports: VIEWPORTS,
      font: 'Helvetica, Arial, sans-serif through --int-font-ui (normalizeFont); Chromium launched with --font-render-hinting=none; theme, text size and density at the mock defaults',
      engineDifferences, engineOtherDifferences,
      pageErrors: Object.fromEntries(Object.entries(pageErrors).filter(([, v]) => v.length)),
      failures,
      notes: [
        'Rectangles [x, y, w, h] are absolute viewport CSS px at 0.01. A node that does not exist is null.',
        'Where Chromium differs from WebKit by at most 0.5 px (and in nothing else) a node is stored once, under webkit. The chromium maps hold only the nodes that differ (resolveNode); a chromium paint part is absent when it equals the webkit one (resolvePaint).',
        'The detail page `?page=shell/page-kit-detail&lab=1` has no a.link in its Pods table: its first cell is a button.linkbtn. The paint part `link` is the first a.link of the Details card (the namespace), `linkbtn` the first linkbtn of the Pods table, `linkbtnShowAll` the `Show all 12` of tagsMany.',
        'The aside cases sit in a fixed 341.671875 px column ([data-probe-col]) at both viewports; the real aside is 341.67 at 1440 and, wrapped under the main column, as wide as the main column (957) at 1280.',
        'kv1 has 7 rows (the spec lists 6; row 6 is a code row with copy: true), kv3 has 10 rows (9 plain, row 9 is the wide one).',
        'The paint focus of a part that is no control is the focus of its nearest button or link ancestor (focusTag says which); a part with none has no focus state.',
      ],
    },
    detail: reduced.detail, sections: reduced.sections, paint: reduced.paint, checks,
  };
  const text = `${JSON.stringify(doc)}\n`;
  const size = Buffer.byteLength(text);
  if (writeOut && size > MAX_BYTES) fail('size', `${size} bytes exceed ${MAX_BYTES}`);
  // The reference a later probe compares with is replaced only by a run that passed every check, the size included. A run that failed one is written beside it, in the temporary directory, with
  // its failures in `meta`, for diagnosis: `mock-detail.json` (or the partial file of a debug run) is left exactly as it was.
  const rejected = failures.length > 0;
  const file = rejected ? path.join(tmpdir(), 'mock-detail.rejected.json') : path.join(here, writeOut ? 'mock-detail.json' : 'mock-detail.partial.json');
  writeFileSync(file, rejected ? `${JSON.stringify({ ...doc, meta: { ...doc.meta, failures } })}\n` : text);
  console.log(rejected ? 'REJECTED, not the reference; written to' : 'wrote', file, size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  console.log('checks', JSON.stringify(checks));
  console.log('engineDifferences', engineDifferences.length, engineDifferences.slice(0, 40));
  console.log('engineOtherDifferences', engineOtherDifferences.length, engineOtherDifferences.slice(0, 20));
  const topErrors = Object.entries(pageErrors).filter(([, v]) => v.length);
  if (topErrors.length) console.log('pageErrors', JSON.stringify(Object.fromEntries(topErrors)).slice(0, 600));
  if (rejected) { console.log('FAILED:\n' + failures.join('\n')); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
