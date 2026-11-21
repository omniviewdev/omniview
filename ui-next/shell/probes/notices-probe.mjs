// Probes the shell's notification surfaces against the design mock's, in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15; 1030 x 720 is retired): the toast layer (ui-next/shell/notices) and the notification centre, the bell in the
// status bar and the popover of history it opens (the same directory). Both are read on the fixture (notices-fixture.tsx: the real `Shell` with its panel and palette, the real `Toasts`, the real bell and centre, the real notices model over a
// clock the probe drives or over the platform's), on which the probe raises records. The toast layer's reference is mock-notices.json, made by mock-notices-measure.mjs from the mock's own toast layer in three scenes (info, failure, cap); the
// centre's is mock-notice-centre.json, made by mock-notice-centre-measure.mjs from the mock's own centre in eleven scenes (centre-targets.mjs names every part and every style it reads).
//
//   node ui-next/shell/probes/notices-probe.mjs        builds the fixtures (OMNIVIEW_UI=next) into temp dirs, serves them, probes them
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds (production, and development for the commit counts)     FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      AXE=<axe.min.js>      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a screenshot per scene (toast-<scene>-<engine>-<viewport>.png, centre-<scene>-<engine>-<viewport>.png)
//   SECTIONS=geometry,a11y,keyboard,lifetime,announce,perf,placement,centre   (default: all of them)
//   NEGATIVE_CONTROL=<name>   perturb ONE measured value in the page (toast-width, gap, retry-paint, no-alert, no-live, steals-focus, sticky-closes, no-hold, hover-stuck, modal-leaks, timer-left, layout-shift, no-avoid, covers,
//                             yield-stop, told-twice, f6-first, no-restore, yield-expires, yield-drops-focus: the 20 of the toast layer; centre-width, centre-row, centre-dot, centre-bell-number, centre-menu-offset, centre-no-name,
//                             centre-escape, centre-focus, centre-outside, centre-two-stops, centre-listener-left, centre-timer-left, centre-second-commit, centre-slow-open: the 14 of the centre; all of PERTURBATIONS, in its order), run the
//                             section that must see it, and exit 0 when it did and 1 when it did not
//                             (Chromium at 1440 x 900 unless ENGINES and VIEWPORTS say otherwise)
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: a control is shown to depend on its assertion by running it with its own pattern
//                             (PERTURBATIONS[<name>].expected) here, and it must then print NOT DETECTED (the rule for a negative control)
//
// What it checks, per engine and viewport:
//   geometry    three scenes of the mock (one info toast; a failure with its Retry, primary; the stack at the cap: the summary toast with its Show over the two newest, which the fixture's `centre` makes 70 px tall as the mock's):
//               the layer, the stack, each toast, its glyph, text column, title, sentence, buttons and dismiss control, and the 8 px between toasts, against the mock within 1 px. The scenes' words are fixed on both sides, but the
//               width of a title and of a button follows its text, which a runner draws with another font than the mock was measured with, so for those two the probe compares where they start, where they sit and how tall they are
//               (`content` boxes, counted in the report with the `full` ones; both widths are printed in `textWidths`). The paint (fill, edge, radius, colours, type, the primary button) is compared exactly. The mock puts the
//               dismiss control's -4 px margins on the control, the shell on the box that holds it (a kit button takes no margin): the probe reads them where each is, and the control's own box is compared with the rest.
//               The scenes read the `clock` case, so that no toast can close while a loaded machine is slow to read it. Each toast's words, severity and glyph are pinned too (the summary toast over a warning draws the warning glyph, where the
//               mock's is always the info one: the model's rule QA-SF-13, not the view's).
//   a11y        axe-core on the layer and the two live regions with the stack open (a failure with its Retry and an info toast, and the stack at the cap), and with a success, a failure and a warning in each of the nine themes. The
//               page around them is the shell's, whose own findings the shell's probes keep (page-has-heading-one, region on the rail): axe is run on the toast layer's part of the DOM, as the palette probe runs it on its dialog.
//   keyboard    with real key presses, on the platform's own timers: nothing takes the focus when a toast appears (from a control, and from nowhere); F6 cycles the regions and reaches the toasts LAST (the first toast is its one
//               stop), Shift+F6 from the first region goes to it, with the panel open or closed; Tab goes from the toast to its action button and then to its dismiss control; Escape closes the focused toast and the focus goes back
//               to the control it came from; the last toast closed leaves no landmark, no F6 stop and no host, and the layer stays, still a polite live region.
//   lifetime    on a clock the probe drives: an info toast closes after 8000 ms and is still there at 7999; a failure is still there after 60 s; a pointer over a toast and the focus in it each stop the clock, and when both are gone the
//               toast has at least 2 s more; a toast removed under the pointer, or that had the focus, lets the clock go; a modal (the palette, wired as the host wires it) takes the stack away from the DOM and brings it back when it
//               closes, with at least 2 s more; a stack that has no room (a probe-only button over the whole window) is hidden and holds the clocks (after 20 s hidden its toast is still in the DOM and in the model's list), and when it
//               comes home the toast has the 5 s it had left (still there at 4990 ms, gone at 5010).
//   announce    what a screen reader is told, recorded by a MutationObserver installed before the page's scripts run: the layer and the window's two live regions exist, empty, before the first notice; a failure the user caused is
//               told assertively (it is role=alert) and an info toast politely, once each; a repeat that folds into the toast ("Timed out 2 times") is not told again.
//   perf        production build: 50 notices raised in one tick show the cap (the summary and the two newest) and nothing outside the layer moves (the page's controls and the shell's regions are read before and after, and
//               Chromium's layout-shift observer reads 0: WebKit has none, which the report says); development build (React's Profiler): the burst costs at most one commit for each time the model told the view (two at most); an empty stack
//               holds nothing: no listener, observer or timer more than before the first toast, whether the stack was emptied by the user or its toasts closed by themselves (the model's own pending timers are counted on the clock
//               the probe drives), and nothing runs while it is empty.
//   placement   (P7, S79) on the real shell at both sizes, with the panel closed and open, and with the palette open, and with probe-only controls where the stack stands (a button 2 px from home, a column of row buttons, a button
//               over the whole window): `data-place`, the stack's box and the nearest control to it are recorded in a table; no toast is ever over the centre of a control (every control's centre is hit-tested), at home no control is
//               nearer than 4 px and moved none is nearer than 8, the palette takes the stack away and it comes back, and a stack with no room is hidden, inert, no F6 stop, told once, and comes home when room is made. With the focus in the
//               stack when it yields (F6 into the first toast, then the button over the window) the focus goes back to the control it came from, or, when that was removed, to a control before the stack in the document (here the status
//               bar's panel toggle); never to the body, never left in the stack.
//   centre      (O1b-2, the part names of PERTURBATIONS: `geometry`, `a11y`, `keys`, `open`, `closed`, `commits`) the bell and the popover of history, on the fixture's window with a history it starts with (`seed=`):
//               geometry  the mock's eleven scenes (closed, the bell with an unread info, warning and error, empty, list, an open row, filtered, muted, the Filter menu, the dots): every box of centre-targets.mjs within 1 px and every
//                         style it reads exactly, and the words of each scene against the mock's own (its facts). The shell has not built the segmented view (28 px and an 8 px gap above the tools), the footer (33 px) or the Filter menu's
//                         severity group (153 px): the probe moves the MOCK's boxes by exactly those, and the report counts the comparisons by class (`full`, `words` for a box whose width follows its words, and how many of them were moved by
//                         the `view`, the `footer` and the `severity` group, and the boxes the shell has not built: `absent`). The two other differences are by decision and compared against the mock's own words for them: opening a row
//                         reads it (S81), so the bell counts one less and the row has no unread mark in the scene `expanded`; a closed centre is not in the document at all.
//               a11y      axe on the bell closed and on the popover open (the list, an open row, the Filter menu, the empty state), and on the open list in each of the nine themes.
//               keys      real key presses: Tab reaches the bell; Enter and Space open it and the focus is on the newest row's title (the popover itself when there is none); Escape closes it and the focus is back on the bell; a press outside
//                         closes it and leaves the focus on what was pressed; the list is one tab stop (the current row's title and Dismiss, and no other row's), the arrows, Home and End move between rows, Tab goes through the row's own
//                         buttons and leaves the list, Delete removes the row; the Filter menu: Enter opens it on its first item, the arrows, Home and End move in it, Escape closes only the menu and the focus is back on Filter.
//               open      production build, 500 records: the page's work from a real click on the bell to the layout of the popover (the click is timed at the window, capture to bubble; a microtask lets React render, then the popover's
//                         box is read) is under two frames (33.3 ms) at its median of nine opens, and the first 50 rows are drawn and "Show 450 older" offered. Every sample and the machine's load are printed.
//               closed    production build: a closed centre holds nothing: the registrations on the window and the document, the observers and the timers and frames outstanding are what they were before the first open, after it was opened,
//                         used and closed three times and after a notice arrived while it was closed (a source that is muted, so that no toast stands: the tooltip host's own observer is the host's, so the pointer and the focus are off the bell), and
//                         no timer or frame callback runs while it is closed.
//               commits   development build (React's Profiler): a new notice while the centre is open costs ONE commit, the announcement and the bell included, and no toast; 50 notices raised in one tick cost at most one commit for each
//                         time the model told the view (two times at most).
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';
import { PARTS, readParts, readStyles } from './notices-targets.mjs';
import { PARTS as CENTRE_PARTS, readStyles as readCentreStyles } from './centre-targets.mjs';
import { script, watch } from './palette-perf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-notices.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(NATIVE_VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { geometry: {}, geometryClasses: {}, textWidths: {}, paint: {}, a11y: {}, keyboard: {}, lifetime: {}, announce: {}, perf: {}, placement: [], centre: {}, notes: [] };
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
const fail = (where, what) => {
  const line = `${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};

const round = (value) => Math.round(value * 100) / 100;
const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const WAIT = 8000;

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side. Every function here is stringified into an init script (`script`) or handed to `page.evaluate`: it runs in the page and uses nothing of this module.

/**
 * What a screen reader is told of the toast layer, from the DOM alone: `window.__told` is a list of `{ kind: 'polite' | 'assertive', via, text }` in the order things happened. A MutationObserver installed before the page's
 * own scripts run sees every node that is added to a live region and every text that changes in one (the default `aria-relevant`, additions and text: a removal and an attribute are never told). `via` is `live` for a
 * sentence put in one of the window's two live regions (`data-notices-part` live: polite, alert: assertive), `toast` for a toast inserted into the layer (assertive when it is `role=alert`, polite otherwise), and `text`
 * for words added to a toast that was already there. What is hidden (`inert`, `hidden`, `aria-hidden`, `visibility: hidden`, `display: none`) is not told.
 */
function recorder() {
  const told = (window.__told = []);
  const KIND = { live: 'polite', alert: 'assertive' };
  const words = (node) => ((node instanceof Element ? node.innerText : node.textContent) ?? '').replace(/\s+/g, ' ').trim();
  const hidden = (element) => {
    for (let node = element; node !== null; node = node.parentElement) {
      if (node.hasAttribute('inert') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return true;
    }

    const style = getComputedStyle(element);
    return style.visibility === 'hidden' || style.display === 'none';
  };
  const note = (kind, via, text) => {
    if (text !== '') told.push({ kind, via, text });
  };
  const roleKind = (toast) => (toast.getAttribute('role') === 'alert' ? 'assertive' : 'polite');
  const visit = (node) => {
    const element = node instanceof Element ? node : node.parentElement;
    if (element === null) return;
    const region = element.closest('[data-notices-part="layer"], [data-notices-part="live"], [data-notices-part="alert"]');
    if (region === null) return;
    if (hidden(element)) return;
    const part = region.getAttribute('data-notices-part');
    if (part === 'live' || part === 'alert') {
      note(KIND[part], 'live', words(node));
      return;
    }

    const toasts = node instanceof Element ? [...(node.matches('[data-notices-part="toast"]') ? [node] : []), ...node.querySelectorAll('[data-notices-part="toast"]')] : [];
    if (toasts.length > 0) {
      for (const toast of toasts) note(roleKind(toast), 'toast', words(toast));
      return;
    }

    const toast = element.closest('[data-notices-part="toast"]');
    note(toast === null ? 'polite' : roleKind(toast), toast === null ? 'layer' : 'text', words(node));
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) visit(node);
      } else if (record.type === 'characterData') {
        visit(record.target);
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

/** The engine's own hit test, kept before the page's scripts run: a perturbation that replaces `document.elementsFromPoint` blinds the page, not the probe. */
function native() {
  window.__native = { elementsFromPoint: document.elementsFromPoint.bind(document) };
}

/** The observers a page holds: every MutationObserver, ResizeObserver and IntersectionObserver that has a target and has not been disconnected, by kind and number of targets (`window.__observers()`). */
function observers() {
  const live = new Map();
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const Constructor = window[name];
    if (typeof Constructor !== 'function') continue;
    const proto = Constructor.prototype;
    const { observe, unobserve, disconnect } = proto;
    proto.observe = function observeTarget(target, ...rest) {
      const entry = live.get(this) ?? { name, targets: new Set() };
      entry.targets.add(target);
      live.set(this, entry);
      return observe.call(this, target, ...rest);
    };
    if (typeof unobserve === 'function') {
      proto.unobserve = function unobserveTarget(target) {
        const entry = live.get(this);
        entry?.targets.delete(target);
        if (entry?.targets.size === 0) live.delete(this);
        return unobserve.call(this, target);
      };
    }

    proto.disconnect = function disconnectAll() {
      live.delete(this);
      return disconnect.call(this);
    };
  }

  window.__observers = () => [...live.values()].map((entry) => `${entry.name}(${entry.targets.size})`).sort();
}

/**
 * Every control the placement rule counts, read the way a person's pointer meets it (placement.ts's list, restated here: this is the oracle, not an import of the thing it judges): its box, whether the point at its
 * centre reaches it (the engine's `elementsFromPoint`, taken before the page ran), and whether a toast is on top of it there. Also the layer (home, which never moves) and the stack.
 */
function readControls(actionable) {
  const hit = window.__native?.elementsFromPoint ?? ((x, y) => document.elementsFromPoint(x, y));
  const width = window.innerWidth;
  const height = window.innerHeight;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const layer = document.querySelector('[data-notices-part="layer"]');
  const host = layer?.querySelector('[data-notices-part="host"]') ?? null;
  const boxOf = (element) => {
    const box = element.getBoundingClientRect();
    return [box.left, box.top, box.right, box.bottom];
  };
  const controls = [];
  for (const element of document.querySelectorAll(actionable)) {
    if (layer?.contains(element) || element.disabled === true) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 6 || box.height < 6 || box.bottom <= 0 || box.right <= 0 || box.top >= height || box.left >= width || element.closest('[inert],[hidden]') !== null) continue;
    const stack = hit(clamp(Math.round((box.left + box.right) / 2), 0, width - 1), clamp(Math.round((box.top + box.bottom) / 2), 0, height - 1));
    controls.push({
      label: (element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().slice(0, 40),
      box: [box.left, box.top, box.right, box.bottom],
      reached: stack.includes(element),
      covered: layer !== null && stack.some((node) => layer.contains(node)),
    });
  }

  return {
    controls,
    layer: layer === null ? null : boxOf(layer),
    host:
      host === null
        ? null
        : {
          box: boxOf(host),
          place: host.getAttribute('data-place'),
          visibility: getComputedStyle(host).visibility,
          inert: host.inert === true,
          region: host.getAttribute('data-shell-region'),
          toasts: host.querySelectorAll('[data-notices-part="toast"]').length,
        },
    viewport: [width, height],
  };
}

/** Where the focus is, in the words the probe judges it by. `first` is the first toast of the stack (the one F6 stop). */
function describeFocus() {
  const active = document.activeElement;
  return {
    tag: active?.tagName ?? null,
    label: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40),
    region: active?.closest('[data-shell-region]')?.getAttribute('data-shell-region') ?? null,
    part: active?.getAttribute('data-notices-part') ?? null,
    fixture: active?.getAttribute('data-fixture') ?? null,
    inLayer: active?.closest('[data-notices-part="layer"]') != null,
    first: active != null && active === document.querySelector('[data-notices-part="toast"]'),
  };
}

/** What the layer drew: how many toasts, and each one's words, severity, role and buttons (the words a changed toast draws from `data-text` are read from there). */
function facts() {
  const words = (element) => (element?.getAttribute('data-text') ?? element?.textContent ?? '').trim();
  const toasts = [...document.querySelectorAll('[data-notices-part="toast"]')];
  const host = document.querySelector('[data-notices-part="host"]');
  return {
    place: host?.getAttribute('data-place') ?? null,
    summary: toasts.map((toast) => toast.hasAttribute('data-notices-summary')),
    titles: toasts.map((toast) => words(toast.querySelector('[data-notices-part="title"]'))),
    messages: toasts.map((toast) => {
      const message = toast.querySelector('[data-notices-part="message"]');
      return message === null ? null : (message.querySelector('[data-text]')?.getAttribute('data-text') ?? message.textContent.trim());
    }),
    severities: toasts.map((toast) => toast.getAttribute('data-severity')),
    glyphs: toasts.map((toast) => toast.querySelector('[data-notices-part="glyph"] svg')?.getAttribute('data-ov-glyph') ?? null),
    roles: toasts.map((toast) => toast.getAttribute('role')),
    sticky: toasts.map((toast) => toast.hasAttribute('data-sticky')),
    labels: toasts.map((toast) => toast.getAttribute('aria-label')),
    actions: toasts.map((toast) => [...toast.querySelectorAll('[data-notices-part="actions"] button')].map((button) => button.textContent.trim())),
  };
}

/** The records the probe raises (the fixture's store is `window.__notices`; a producer is made for a source, as a plugin's is). The words of the first three are the mock's scenes' (notices-targets.mjs). */
const RAISE = {
  info: () => {
    window.__notices.forSource('p1').notify({ title: 'Connection added', detail: 'prod-east is ready to use.', severity: 'info', initiator: 'system' });
  },
  failure: () => {
    window.__notices.forSource('p1').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'user',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
  },
  cap: () => {
    ['info', 'success', 'warning', 'error', 'info'].forEach((severity, index) => {
      window.__notices.forSource(`p${index + 1}`).notify({ title: `Notice ${index + 1}`, severity, initiator: 'system' });
    });
  },
  // A failure the user caused and an info toast: the two roles, and what an axe run is made of.
  both: () => {
    window.__notices.forSource('p1').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'user',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
    window.__notices.forSource('p2').notify({ title: 'Connection added', detail: 'prod-east is ready to use.', severity: 'info', initiator: 'system' });
  },
  // Two toasts that stay until the user acts (a failure with its Retry, a warning with an action), for the scenes that run on the platform's own timers: no toast of them closes by itself while a loaded machine is slow.
  pair: () => {
    window.__notices.forSource('p1').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'user',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
    window.__notices.forSource('p2').notify({ title: 'Signed out', detail: 'Sign in again to continue.', severity: 'warning', initiator: 'system', actions: [{ id: 'in', label: 'Sign in', run: () => undefined }] });
  },
  // Three toasts that stay, each with a button: as tall as a stack gets without a summary (274 px).
  three: () => {
    window.__notices.forSource('p1').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'user',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
    window.__notices.forSource('p2').notify({ title: 'Signed out', detail: 'Sign in again to continue.', severity: 'warning', initiator: 'system', actions: [{ id: 'in', label: 'Sign in', run: () => undefined }] });
    window.__notices.forSource('p3').notify({ title: 'Quota almost used', detail: 'Free up space to keep saving.', severity: 'warning', initiator: 'system', actions: [{ id: 'free', label: 'Free up space', run: () => undefined }] });
  },
  // A success, an error with its Retry and a warning with an action: the glyphs and the buttons of three severities in one stack (the nine themes' axe run reads it).
  kinds: () => {
    window.__notices.forSource('p1').notify({ title: 'Snapshot created', detail: 'It is ready to restore.', severity: 'success', initiator: 'system' });
    window.__notices.forSource('p2').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'user',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
    window.__notices.forSource('p3').notify({ title: 'Signed out', detail: 'Sign in again to continue.', severity: 'warning', initiator: 'system', actions: [{ id: 'in', label: 'Sign in', run: () => undefined }] });
  },
  // Five errors from five sources: the stack at the cap (the summary and the two newest) that stays.
  errors: () => {
    for (let index = 1; index <= 5; index += 1) window.__notices.forSource(`p${index}`).notify({ title: `Notice ${index}`, severity: 'error', initiator: 'system' });
  },
  // Fifty notices from fifty sources in one tick.
  burst: () => {
    for (let index = 1; index <= 50; index += 1) window.__notices.forSource(`p${index}`).notify({ title: `Notice ${index}`, severity: 'info', initiator: 'system' });
  },
};

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls: one perturbation of one measured value, made in the page (a stylesheet, or a script that runs before the page's own and watches for what it perturbs). The probe must see it. With NEGATIVE_CONTROL
// the exit code is 0 when it did: when a failure that says what `expected` says was recorded. With ASSERTION_OFF set to `expected`'s source that assertion is gone, and the control must go undetected.
// `sections` is what runs, `scenes` or `parts` (which scenes or parts of the section) narrow it to the one that sees the perturbation.
const PERTURBATIONS = {
  'toast-width': { css: '[data-notices-part="toast"] { inline-size: 440px !important; }', sections: ['geometry'], scenes: ['info'], expected: /^geometry [^:]* info: toast 1\[w\]/ },
  gap: { css: '[data-notices-part="host"] { row-gap: 14px !important; }', sections: ['geometry'], scenes: ['cap'], expected: /^geometry [^:]* cap: gap between toast 1 and 2/ },
  'retry-paint': { css: '[data-notices-part="actions"] button { background-color: rgb(1, 2, 3) !important; }', sections: ['geometry'], scenes: ['failure'], expected: /^paint [^:]* failure: action#0 backgroundColor/ },
  // A failure that is announced as a status: its role is taken away as it is inserted.
  'no-alert': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const toast of [node, ...node.querySelectorAll('[role="alert"]')]) {
              if (toast.matches('[data-notices-part="toast"][role="alert"]')) toast.setAttribute('role', 'status');
            }
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['announce'],
    expected: /^announce [^:]*: the failure toast was not announced assertively/,
  },
  // A layer that is not a live region.
  'no-live': {
    init: script(() => {
      new MutationObserver(() => {
        document.querySelector('[data-notices-part="layer"]')?.removeAttribute('aria-live');
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['announce'],
    expected: /^announce [^:]*: the layer is not a polite live region/,
  },
  // A toast that takes the focus as it is inserted.
  'steals-focus': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const toast of node.matches('[data-notices-part="toast"]') ? [node] : node.querySelectorAll('[data-notices-part="toast"]')) toast.focus();
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['keyboard'],
    expected: /^keyboard [^:]*: a toast took the focus when it appeared/,
  },
  // A failure that closes by itself after 8 s on the model's clock.
  'sticky-closes': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('[data-severity="error"]') || node.querySelector('[data-severity="error"]') !== null)) {
              window.__clock?.scheduler.setTimeout(() => window.__notices.dismissToasts(), 8000);
            }
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['lifetime'],
    parts: ['sticky'],
    expected: /^lifetime [^:]* sticky: the failure toast was gone/,
  },
  // A pointer over a toast that the layer never hears of.
  'no-hold': {
    init: script(() => {
      document.addEventListener(
        'pointerover',
        (event) => {
          if (event.target instanceof Element && event.target.closest('[data-notices-part="toast"]') !== null) event.stopPropagation();
        },
        true,
      );
    }),
    sections: ['lifetime'],
    parts: ['pointer'],
    expected: /^lifetime [^:]* pointer: the toast closed while the pointer was over it/,
  },
  // An engine that goes on saying a toast is under the pointer after the toast was removed (`:hover` is true for ever): the layer must not trust a hold it cannot see the end of.
  'hover-stuck': {
    init: script(() => {
      const matches = Element.prototype.matches;
      Element.prototype.matches = function matchesHover(selector) {
        return selector === ':hover' ? true : matches.call(this, selector);
      };
    }),
    sections: ['lifetime'],
    parts: ['gone'],
    expected: /^lifetime [^:]* gone: the clocks are still held after the toast under the pointer was removed/,
  },
  // A modal that is open and does not hold the stack: the host's wiring is undone as soon as the palette opens.
  'modal-leaks': {
    init: script(() => {
      new MutationObserver(() => {
        if (document.querySelector('dialog[open]') !== null) window.__notices?.hold('modal', false);
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    }),
    sections: ['lifetime'],
    parts: ['modal'],
    expected: /^lifetime [^:]* modal: the stack was drawn while the palette was open/,
  },
  // A timer that is started when the stack goes empty and is never cleared.
  'timer-left': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof Element && node.matches('[data-notices-part="host"]')) window.setTimeout(() => undefined, 600000);
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['perf'],
    parts: ['empty'],
    expected: /^perf [^:]* empty: \d+ timeouts outstanding after the stack was empty/,
  },
  // The page's control moves down when the stack appears (a layout that depends on the toasts), which the rects and Chromium's layout-shift observer both see.
  'layout-shift': {
    css: 'body:has([data-notices-part="host"]) [data-fixture="page-control"] { margin-top: 10px !important; }',
    sections: ['perf'],
    parts: ['burst'],
    expected: /^perf [^:]* burst: (a control moved|layout shift)/,
  },
  // A placement that is blind: the page answers every hit test with nothing, so no control is ever reached and the stack never moves for one.
  'no-avoid': {
    init: script(() => {
      document.elementsFromPoint = () => [];
    }),
    sections: ['placement'],
    scenes: ['near'],
    expected: /^placement [^:]* near: the stack stands at home with a control/,
  },
  // A stack that is moved over the controls it was moved for.
  covers: {
    css: '[data-notices-part="host"][data-place="moved"] { left: calc(var(--_x) + 40px) !important; }',
    sections: ['placement'],
    scenes: ['column'],
    expected: /^placement [^:]* column: a toast covers/,
  },
  // A stack that has no room, hidden and inert, that is still a region of F6.
  'yield-stop': {
    init: script(() => {
      new MutationObserver(() => {
        for (const host of document.querySelectorAll('[data-notices-part="host"][data-place="yield"]')) host.setAttribute('data-shell-region', 'toasts');
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-place'] });
    }),
    sections: ['placement'],
    scenes: ['yield'],
    expected: /^placement [^:]* yield: the yielded stack is still a region of F6/,
  },
  // A toast that is told again when its words change: a text is added to the toast when it folds a repeat ("Timed out 2 times").
  'told-twice': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target instanceof Element && record.target.closest('[data-notices-part="toast"]') !== null) record.target.append(document.createTextNode(` ${record.target.getAttribute('data-text') ?? ''}`));
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-text'] });
    }),
    sections: ['announce'],
    expected: /^announce [^:]*: the repeat that folded into a toast was told again/,
  },
  // The toasts' region moved before the others in the document: F6 reaches it first and not last.
  'f6-first': {
    init: script(() => {
      new MutationObserver(() => {
        const layer = document.querySelector('[data-notices-part="layer"]');
        if (layer?.parentElement && layer.parentElement.firstElementChild !== layer) layer.parentElement.prepend(layer);
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['keyboard'],
    expected: /^keyboard [^:]*: F6 did not reach the toasts last/,
  },
  // A closed toast that takes the focus with it: whatever has the focus is blurred when a toast leaves the DOM, so the layer's gift of the focus back is undone.
  'no-restore': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof Element && (node.matches('[data-notices-part="toast"]') || node.querySelector('[data-notices-part="toast"]') !== null) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['keyboard'],
    expected: /^keyboard [^:]*: Escape in a toast did not give the focus back/,
  },
  // A stack that has no room and lets its clocks run: the hold the hook puts on them while it is hidden is let go (the hook puts it in an effect, after the page's first look at the attribute, so the release is repeated while the
  // stack yields), and a toast that nobody could read goes on its way to its end.
  'yield-expires': {
    init: script(() => {
      const release = () => {
        if (document.querySelector('[data-notices-part="host"][data-place="yield"]') !== null) window.__notices?.hold('yield', false);
      };
      new MutationObserver(release).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-place'] });
      window.setInterval(release, 10);
    }),
    sections: ['lifetime'],
    parts: ['yield'],
    expected: /^lifetime [^:]* yield: the clocks did not wait while the stack had no room/,
  },
  // The focus ends on the body once the stack has yielded, as the engine leaves it when the element that had it goes inert: whatever the layer did before, it is dropped after it (once as the stack yields, and for as long as it is hidden).
  'yield-drops-focus': {
    init: script(() => {
      const drop = () => {
        if (document.querySelector('[data-notices-part="host"][data-place="yield"]') !== null && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
      };
      new MutationObserver(() => queueMicrotask(drop)).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-place'] });
      window.setInterval(drop, 10);
    }),
    sections: ['placement'],
    scenes: ['yield-focus'],
    expected: /^placement [^:]* yield-focus: the focus was lost when the stack yielded/,
  },
  // The notification centre's controls (O1b-2). Each is made in the page after it loaded, runs the one part of the `centre` section that must see it (Chromium, 1440 x 900), and with its assertion dropped (ASSERTION_OFF) is not detected.
  // A popover 20 px too wide.
  'centre-width': { css: '[data-notices-part="centre"] { inline-size: 440px !important; }', sections: ['centre'], parts: ['geometry'], scenes: ['list'], expected: /^centre geometry [^:]* list: centre\[w\]/ },
  // A row 2 px too tall.
  'centre-row': { css: '[data-notices-part="rowToggle"] { min-block-size: 42px !important; }', sections: ['centre'], parts: ['geometry'], scenes: ['list'], expected: /^centre geometry [^:]* list: row 1\[h\]/ },
  // The bell's dot of an unread warning in the wrong colour.
  'centre-dot': { css: '[data-notices-part="bellDot"] { background-color: rgb(1, 2, 3) !important; }', sections: ['centre'], parts: ['geometry'], scenes: ['bell-warning'], expected: /^centre paint [^:]* bell-warning: bellDot backgroundColor/ },
  // A bell that says how many are unread in its dot: a number, which the bell never shows (A12).
  'centre-bell-number': {
    init: script(() => {
      const number = () => {
        for (const dot of document.querySelectorAll('[data-notices-part="bellDot"]')) if (dot.textContent !== '3') dot.textContent = '3';
      };
      new MutationObserver(number).observe(document, { subtree: true, childList: true, characterData: true });
    }),
    sections: ['centre'],
    parts: ['geometry'],
    scenes: ['bell-error'],
    expected: /^centre facts [^:]* bell-error: the bell's dot holds "3"/,
  },
  // A Filter menu 20 px from where the Filter button hangs it.
  'centre-menu-offset': { css: '[data-notices-part="filterMenu"] { left: calc(var(--_edge) + 20px) !important; }', sections: ['centre'], parts: ['geometry'], scenes: ['menu'], expected: /^centre geometry [^:]* menu: menu\[right edge on the Filter button's\]/ },
  // An unnamed dialog: the name is taken off the centre as it is drawn.
  'centre-no-name': {
    init: script(() => {
      new MutationObserver(() => {
        for (const dialog of document.querySelectorAll('[data-notices-part="centre"][aria-label]')) dialog.removeAttribute('aria-label');
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['centre'],
    parts: ['a11y'],
    scenes: ['list'],
    expected: /^centre a11y [^:]* list: aria-dialog-name/,
  },
  // A centre that Escape does not close: the key never reaches the page.
  'centre-escape': {
    init: script(() => {
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') event.stopPropagation();
        },
        true,
      );
    }),
    sections: ['centre'],
    parts: ['keys'],
    expected: /^centre keyboard [^:]*: Escape did not close the centre:/,
  },
  // A close that leaves the focus on nothing: whatever has the focus is blurred when the centre leaves the document, so the gift of the focus back to the bell is undone.
  'centre-focus': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof Element && node.matches('[data-notices-part="centre"]') && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['centre'],
    parts: ['keys'],
    expected: /^centre keyboard [^:]*: the focus did not go back to the bell after Escape/,
  },
  // A press outside that the centre never hears of.
  'centre-outside': {
    init: script(() => {
      window.addEventListener('pointerdown', (event) => event.stopPropagation(), true);
    }),
    sections: ['centre'],
    parts: ['keys'],
    expected: /^centre keyboard [^:]*: a press outside did not close the centre:/,
  },
  // A list with two tab stops: every row's title is in the tab order.
  'centre-two-stops': {
    init: script(() => {
      const mark = () => {
        for (const toggle of document.querySelectorAll('[data-notices-part="rowToggle"]')) if (toggle.getAttribute('tabindex') !== '0') toggle.setAttribute('tabindex', '0');
      };
      new MutationObserver(mark).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex'] });
    }),
    sections: ['centre'],
    parts: ['keys'],
    expected: /^centre keyboard [^:]*: the list is not one tab stop/,
  },
  // A closed centre that leaves a listener on the document each time it closes.
  'centre-listener-left': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof Element && node.matches('[data-notices-part="centre"]')) document.addEventListener('keydown', function left() {});
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['centre'],
    parts: ['closed'],
    expected: /^centre closed [^:]*: \d+ registrations on the window or the document that the centre left behind/,
  },
  // A closed centre that leaves a timer each time it closes.
  'centre-timer-left': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof Element && node.matches('[data-notices-part="centre"]')) window.setTimeout(() => undefined, 600000);
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['centre'],
    parts: ['closed'],
    expected: /^centre closed [^:]*: \d+ timeouts outstanding/,
  },
  // A second commit for a new notice while the centre is open: the page reads the new record as soon as its row is drawn.
  'centre-second-commit': {
    init: script(() => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            const row = node instanceof Element ? (node.matches('[data-notices-part="row"]') ? node : node.querySelector('[data-notices-part="row"]')) : null;
            if (row !== null && row.textContent.includes('Backup finished')) queueMicrotask(() => window.__notices.read(row.getAttribute('data-notices-id')));
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }),
    sections: ['centre'],
    parts: ['commits'],
    expected: /^centre commits [^:]*: a new notice while the centre was open cost \d+ commits/,
  },
  // An open that takes the page over two frames: a busy loop in the click that opens it.
  'centre-slow-open': {
    init: script(() => {
      document.addEventListener(
        'click',
        (event) => {
          if (event.target instanceof Element && event.target.closest('[data-notices-part="bell"]') !== null) {
            const end = performance.now() + 40;
            while (performance.now() < end);
          }
        },
        true,
      );
    }),
    sections: ['centre'],
    parts: ['open'],
    expected: /^centre open [^:]*: the centre took [\d.]+ ms at its median/,
  },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);

/** What a perturbation adds to every page: its stylesheet at DOMContentLoaded, and its script, which runs before the page's own. */
const controlInit =
  CONTROL === ''
    ? ''
    : [
      PERTURBATIONS[CONTROL].css === undefined
        ? ''
        : `document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = ${JSON.stringify(PERTURBATIONS[CONTROL].css)}; document.head.append(style); });`,
      PERTURBATIONS[CONTROL].init ?? '',
    ].join('\n');

/**
 * The init script of a page: the engine's own hit test first (a perturbation must not blind the probe), then the perturbation (its observers are made before the recorder's, so that they see a mutation first), then what the
 * section installs.
 */
const initOf = (...scripts) => [script(native), controlInit, ...scripts].filter((text) => text !== '').join('\n');

// ---------------------------------------------------------------------------------------------------------------------------
// Opening pages and driving them, the way a person does.
const fixtureUrl = (origin, query) => `${origin}/shell/probes/notices-fixture.html?${query}`;
const isMac = (page) => page.evaluate(() => /mac/i.test(navigator.platform));
const chordOf = async (page) => ((await isMac(page)) ? 'Meta+k' : 'Control+k');
// WebKit on macOS skips buttons with Tab (Alt+Tab reaches them: the window's own setting, which the native app turns on, N22); everywhere else Tab reaches every control.
const tabKey = (engine) => (engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');

/** A fresh page on the fixture. `font: false` leaves the fonts alone, for the sections that count the timers a page runs (the settling of a font is itself a timer). */
async function scenePage(browser, origin, viewport, query, { init = [], font = true } = {}) {
  const opened = await open(browser, fixtureUrl(origin, query), viewport, { init: initOf(...init) });
  if (font) {
    await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
    await sleep(200);
  }

  return opened;
}

const advance = (page, ms) => page.evaluate((value) => window.__clock.advance(value), ms);
/** The model tells its views at most once a frame, and on a clock that stands still the frame never ends: the probe lets one frame of the model's clock pass after it acts. */
const settle = async (page) => {
  await advance(page, 16);
  await sleep(80);
};
const toastCount = (page) => page.evaluate(() => document.querySelectorAll('[data-notices-part="toast"]').length);
const hostCount = (page) => page.evaluate(() => document.querySelectorAll('[data-notices-part="host"]').length);
const waitStack = (page, toasts, timeout = WAIT) =>
  page.waitForFunction((count) => document.querySelectorAll('[data-notices-part="toast"]').length === count, toasts, { timeout }).then(
    () => true,
    () => false,
  );
const pageErrors = (where, errors) => {
  for (const error of errors) fail(`errors ${where}`, error);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry and paint, against the mock's reading. A rectangle is [x, y, w, h].
const TOLERANCE = 1;
/** The parts whose width follows the words they hold: compared by where they start, where they sit and how tall they are. */
const TEXT = new Set(['title', 'action']);
const SCENES = { info: 'case=clock', failure: 'case=clock', cap: 'case=clock&centre=1' };
/**
 * What each scene must have drawn, which is what the mock's scene draws (mock-notices-measure.mjs `EXPECT`), with one deviation that is the model's rule and not the view's: the summary toast takes the severity of the worst of the records
 * it stands for (QA-SF-13, core/notices/README.md), so over an info, a success and a warning it draws the warning glyph, where the mock's summary is always `info` (shell-notify.js `summaryRecord`). The comparison with the mock
 * cannot say so (a glyph's colour is on its paths and the svg's own `color` is the same for every glyph), so the glyphs are pinned here.
 */
const WANT = {
  info: { place: null, summary: [false], titles: ['Connection added'], messages: ['prod-east is ready to use.'], severities: ['info'], glyphs: ['status-info'], actions: [[]] },
  failure: { place: null, summary: [false], titles: ['Timed out'], messages: ['The cluster did not complete the request in time.'], severities: ['error'], glyphs: ['status-error'], actions: [['Retry']] },
  cap: { place: null, summary: [true, false, false], titles: ['3 more notifications', 'Notice 4', 'Notice 5'], messages: [null, null, null], severities: ['warning', 'error', 'info'], glyphs: ['status-warning', 'status-error', 'status-info'], actions: [['Show'], [], []] },
};

function compareScene(mock, shell) {
  const problems = [];
  // What each comparison is OF, so that nothing is loosened without being counted. `full`: every one of the box's x, y, width and height. `content`: a box whose width follows its words (a title, a button).
  const classes = { full: 0, content: 0 };
  const widths = {};
  let worst = 0;
  for (const part of PARTS) {
    const wanted = mock[part.name] ?? [];
    const got = shell[part.name] ?? [];
    if (got.length !== wanted.length) {
      problems.push(`${part.name}: ${got.length} drawn, the mock's scene has ${wanted.length}`);
      continue;
    }

    const keys = TEXT.has(part.name) ? [0, 1, 3] : [0, 1, 2, 3];
    wanted.forEach((rect, index) => {
      const name = `${part.name}${part.all === true ? ` ${index + 1}` : ''}`;
      classes[keys.length === 4 ? 'full' : 'content'] += 1;
      for (const key of keys) {
        const delta = round(Math.abs(rect[key] - got[index][key]));
        worst = Math.max(worst, delta);
        if (delta > TOLERANCE) problems.push(`${name}[${'xywh'[key]}]: mock ${rect[key]} shell ${got[index][key]} (off by ${delta})`);
      }

      if (keys.length < 4) widths[name] = [rect[2], got[index][2]];
    });
  }

  // The gap between two toasts of the stack: 8 px.
  const [mine, theirs] = [mock.toast ?? [], shell.toast ?? []];
  for (let index = 1; index < Math.min(mine.length, theirs.length); index += 1) {
    const gapMock = round(mine[index][1] - (mine[index - 1][1] + mine[index - 1][3]));
    const gapShell = round(theirs[index][1] - (theirs[index - 1][1] + theirs[index - 1][3]));
    if (Math.abs(gapMock - gapShell) > TOLERANCE) problems.push(`gap between toast ${index} and ${index + 1}: mock ${gapMock} shell ${gapShell} (off by ${round(Math.abs(gapMock - gapShell))})`);
  }

  return { problems, worst, classes, widths };
}

/** The paint of one scene: every entry of STYLES that the mock has, compared exactly. The dismiss control's margins are the mock's on the control and the shell's on the box that holds it: each is read where it is. */
function comparePaint(mock, shell, wrapper) {
  const problems = [];
  for (const [name, wanted] of Object.entries(mock)) {
    const got = shell[name];
    if (got === undefined) {
      problems.push(`${name}: the shell does not draw it`);
      continue;
    }

    for (const [prop, value] of Object.entries(wanted)) {
      const have = name === 'dismiss' && (prop === 'marginTop' || prop === 'marginRight') ? wrapper?.[prop] : got[prop];
      if (have !== value) problems.push(`${name} ${prop}: mock ${value} shell ${have}`);
    }
  }

  return problems;
}

async function geometry(browser, engine, viewportName, viewport, origin, only) {
  const rows = reference.data[engine][viewportName];
  for (const scene of only ?? Object.keys(SCENES)) {
    const where = `${engine} ${viewportName} ${scene}`;
    const { page, context, errors } = await scenePage(browser, origin, viewport, SCENES[scene]);
    await page.mouse.move(1, 1);
    await page.evaluate(RAISE[scene]);
    await settle(page);
    await waitStack(page, WANT[scene].titles.length);
    // The mock is read 150 ms after the toasts are raised, when the 90 ms fade is over; the same here, with room for a machine that is loaded.
    await sleep(450);
    const shellParts = await readParts(page, PARTS, 'shell');
    const shellStyles = await readStyles(page, PARTS, 'shell');
    const wrapper = await page.evaluate(() => {
      const box = document.querySelector('[data-notices-part="dismiss"]')?.parentElement;
      if (box === null || box === undefined) return null;
      const style = getComputedStyle(box);
      return { marginTop: style.marginTop, marginRight: style.marginRight };
    });
    const drew = await page.evaluate(facts);
    const want = WANT[scene];
    for (const key of Object.keys(want)) {
      if (JSON.stringify(drew[key]) !== JSON.stringify(want[key])) fail(`geometry ${where}`, `the scene did not draw what it says: ${key} ${JSON.stringify(drew[key])}, wanted ${JSON.stringify(want[key])}`);
    }

    const result = compareScene(rows[scene].parts, shellParts);
    for (const problem of result.problems) fail(`geometry ${where}`, problem);
    const paint = comparePaint(rows[scene].styles, shellStyles, wrapper);
    for (const problem of paint) fail(`paint ${where}`, problem);
    report.geometry[where] = { worst: result.worst, problems: result.problems.length };
    report.geometryClasses[where] = result.classes;
    report.textWidths[where] = result.widths;
    report.paint[where] = { problems: paint.length };
    pageErrors(where, errors);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-${scene}-${engine}-${viewportName}.png`) });
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a screen reader finds: axe on the toast layer's part of the DOM (the layer, with the stack in it, and the window's two live regions).
const AXE_CONTEXT = { include: [['[data-notices-part="layer"]'], ['[data-notices-part="live"]'], ['[data-notices-part="alert"]']] };
/** The nine themes the host persists (packages/kit/src/generated/tokenNames.ts `THEMES`; `high-contrast-dark`, not the mock's `hc-dark`). */
const THEMES = ['void', 'dark', 'light', 'obsidian', 'carbon', 'solarized-dark', 'solarized-light', 'high-contrast-dark', 'high-contrast-light'];

async function axeOf(page, axe, context = AXE_CONTEXT) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axe });
  return page.evaluate(async (context) => {
    const result = await window.axe.run(context, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 140) }));
  }, context);
}

async function a11y(browser, engine, viewportName, viewport, origin, axe) {
  const where = `${engine} ${viewportName}`;
  const found = {};
  for (const [label, query, raise, toasts] of [
    ['stack', 'case=clock', RAISE.both, 2],
    ['cap', 'case=clock&centre=1', RAISE.cap, 3],
  ]) {
    const { page, context, errors } = await scenePage(browser, origin, viewport, query);
    await page.evaluate(raise);
    await settle(page);
    if (!(await waitStack(page, toasts))) fail(`a11y ${where} ${label}`, `the stack of ${toasts} toasts was not drawn`);
    await sleep(300);
    const violations = await axeOf(page, axe);
    found[label] = violations;
    for (const violation of violations) fail(`a11y ${where} ${label}`, `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
    pageErrors(`${where} ${label}`, errors);
    await context.close();
  }

  // The same in each of the nine themes the host persists (packages/kit/src/generated/tokenNames.ts): a success, an error with its Retry and a warning with an action, over each theme's own roles.
  {
    const { page, context, errors } = await scenePage(browser, origin, viewport, 'case=clock');
    await page.evaluate(RAISE.kinds);
    await settle(page);
    if (!(await waitStack(page, 3))) fail(`a11y ${where} themes`, 'the stack of 3 toasts was not drawn');
    for (const theme of THEMES) {
      await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), theme);
      await sleep(200);
      const violations = await axeOf(page, axe);
      found[`theme ${theme}`] = violations;
      for (const violation of violations) fail(`a11y ${where} theme ${theme}`, `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
    }

    pageErrors(`${where} themes`, errors);
    await context.close();
  }

  report.a11y[where] = found;
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a person does with the keyboard, with real key presses, on the platform's own timers (every toast here stays until the user acts).
/** Presses F6 (or `key`) from nothing until the first stop comes round again: the stops in order. */
async function cycle(page, key = 'F6') {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const stops = [];
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press(key);
    await sleep(60);
    const now = await page.evaluate(describeFocus);
    if (stops.length > 0 && now.region === stops[0].region) break;
    stops.push(now);
  }

  return stops;
}

async function keyboard(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const notes = {};
  const { page, context, errors } = await scenePage(browser, origin, viewport, 'case=real');
  const TAB = tabKey(engine);
  const control = page.locator('[data-fixture="page-control"]');
  const focus = () => page.evaluate(describeFocus);

  // Nothing takes the focus on its own: not from a control, and not from nowhere.
  await control.focus();
  await page.evaluate(RAISE.failure);
  await waitStack(page, 1);
  await sleep(300);
  let now = await focus();
  if (now.fixture !== 'page-control') fail(`keyboard ${where}`, `a toast took the focus when it appeared: the control that had it was left for ${JSON.stringify(now)}`);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.evaluate(() => {
    window.__notices.forSource('p2').notify({ title: 'Signed out', detail: 'Sign in again to continue.', severity: 'warning', initiator: 'system', actions: [{ id: 'in', label: 'Sign in', run: () => undefined }] });
  });
  await waitStack(page, 2);
  await sleep(300);
  now = await focus();
  if (now.tag !== 'BODY') fail(`keyboard ${where}`, `a toast took the focus when it appeared: with nothing focused the focus went to ${JSON.stringify(now)}`);
  const landmark = await page.evaluate(() => ({ regions: document.querySelectorAll('[role="region"][aria-label="Notifications"]').length, stops: document.querySelectorAll('[data-shell-region="toasts"]').length }));
  if (landmark.regions !== 1 || landmark.stops !== 1) fail(`keyboard ${where}`, `a stack of toasts is ${landmark.regions} landmarks and ${landmark.stops} F6 stops, wanted one of each: ${JSON.stringify(landmark)}`);

  // F6 cycles the regions in reading order and the toasts are the last stop, whether the panel is open or not; the first toast is the stop, and Shift+F6 from the first region goes to it. One finding says all of that.
  const closed = await cycle(page);
  const regionsClosed = closed.map((stop) => stop.region);
  notes.f6 = regionsClosed;
  const order = [];
  if (regionsClosed.at(-1) !== 'toasts' || regionsClosed.filter((region) => region === 'toasts').length !== 1 || regionsClosed.length < 4) order.push(`the order is ${regionsClosed.join(' > ')}`);
  if (closed.at(-1)?.first !== true) order.push(`the stop of the toasts is not the first toast: ${JSON.stringify(closed.at(-1))}`);
  await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
  await sleep(300);
  const regionsOpen = (await cycle(page)).map((stop) => stop.region);
  notes.f6Panel = regionsOpen;
  if (regionsOpen.at(-1) !== 'toasts' || regionsOpen.at(-2) !== 'panel') order.push(`with the panel open the order is ${regionsOpen.join(' > ')}`);
  await page.evaluate(() => window.__panel.hide());
  await sleep(300);
  await cycle(page);
  await page.keyboard.press('Shift+F6');
  await sleep(60);
  now = await focus();
  if (now.region !== 'toasts') order.push(`Shift+F6 from the first region went to ${JSON.stringify(now.region)}`);
  if (order.length > 0) fail(`keyboard ${where}`, `F6 did not reach the toasts last, once, as the first toast (${order.join('; ')})`);

  // From the toast: Tab goes to its action button and then to its dismiss control (A14).
  await control.focus();
  await page.keyboard.press('F6');
  await sleep(80);
  now = await focus();
  if (!now.first) fail(`keyboard ${where}`, `F6 from the page did not reach the first toast: ${JSON.stringify(now)}`);
  const tabbed = [];
  for (let press = 0; press < 2; press += 1) {
    await page.keyboard.press(TAB);
    await sleep(60);
    tabbed.push((await focus()).label);
  }

  notes.tab = tabbed;
  if (tabbed[0] !== 'Retry' || tabbed[1] !== 'Dismiss: Timed out') fail(`keyboard ${where}`, `Tab from the toast went to ${JSON.stringify(tabbed)}, wanted its action button (Retry) and then its dismiss control (Dismiss: Timed out)`);

  // Escape closes the focused toast, and the focus goes back to the control it came from: with a toast left, and with the last one.
  await control.focus();
  await page.keyboard.press('F6');
  await sleep(80);
  await page.keyboard.press('Escape');
  await sleep(300);
  now = await focus();
  const left = await page.evaluate(facts);
  if (left.labels.join('|') !== 'Warning: Signed out') fail(`keyboard ${where}`, `Escape in the first toast did not close it, and only it: ${JSON.stringify(left.labels)}`);
  if (now.fixture !== 'page-control') {
    // What follows needs the focus where it was: the scene stops at its first finding.
    fail(`keyboard ${where}`, `Escape in a toast did not give the focus back to the control it came from: ${JSON.stringify(now)}`);
    report.keyboard[where] = notes;
    pageErrors(where, errors);
    await context.close();
    return;
  }

  await page.keyboard.press('F6');
  await sleep(80);
  await page.keyboard.press('Escape');
  await sleep(300);
  now = await focus();
  if (now.fixture !== 'page-control') fail(`keyboard ${where}`, `Escape in the last toast did not give the focus back to the control it came from: ${JSON.stringify(now)}`);

  // A closed stack leaves no landmark, no F6 stop and no host; the layer stays, and is still a polite live region.
  const empty = await page.evaluate(() => {
    const layer = document.querySelector('[data-notices-part="layer"]');
    return {
      hosts: document.querySelectorAll('[data-notices-part="host"]').length,
      regions: document.querySelectorAll('[role="region"][aria-label="Notifications"]').length,
      stops: document.querySelectorAll('[data-shell-region="toasts"]').length,
      layers: document.querySelectorAll('[data-notices-part="layer"]').length,
      live: layer?.getAttribute('aria-live') ?? null,
      toasts: document.querySelectorAll('[data-notices-part="toast"]').length,
    };
  });
  notes.empty = empty;
  if (empty.hosts !== 0 || empty.regions !== 0 || empty.stops !== 0 || empty.toasts !== 0) fail(`keyboard ${where}`, `a stack with no toast left a host, a landmark or an F6 stop: ${JSON.stringify(empty)}`);
  if (empty.layers !== 1 || empty.live !== 'polite') fail(`keyboard ${where}`, `the layer did not stay, a polite live region, when the stack was empty: ${JSON.stringify(empty)}`);
  const afterEmpty = await cycle(page);
  if (afterEmpty.some((stop) => stop.region === 'toasts')) fail(`keyboard ${where}`, `F6 reached the toasts with none drawn: ${afterEmpty.map((stop) => stop.region).join(' > ')}`);

  report.keyboard[where] = notes;
  pageErrors(where, errors);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a toast lives for, and what holds it, on a clock the probe drives (`window.__clock`): the model's 8 s and its holds. The view's own waits (120 ms to ask whether the pointer left) stay real.
async function lifetime(browser, engine, viewportName, viewport, origin, only) {
  const where = `${engine} ${viewportName}`;
  const notes = {};
  const wants = (part) => only === undefined || only.includes(part);

  /** One part in a page of its own. A failed step is a failure of the part. */
  async function part(name, body) {
    if (!wants(name)) return;
    const opened = await scenePage(browser, origin, viewport, 'case=clock');
    try {
      await body(opened.page);
    } catch (error) {
      fail(`lifetime ${where} ${name}`, `the scene did not run: ${firstLine(error)}`);
    } finally {
      pageErrors(`${where} ${name}`, opened.errors);
      await opened.context.close();
    }
  }

  // An info toast closes after 8000 ms, and is there at 7999.
  await part('timed', async (page) => {
    await page.evaluate(RAISE.info);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} timed`, 'the info toast was not drawn');
    await advance(page, 7999);
    await sleep(80);
    if ((await toastCount(page)) !== 1) return fail(`lifetime ${where} timed`, 'the info toast was gone at 7999 ms');
    await advance(page, 1);
    if (!(await waitStack(page, 0, 3000))) fail(`lifetime ${where} timed`, 'the info toast was still there at 8000 ms');
  });

  // A failure stays: it is there after 60 s, and says it is sticky.
  await part('sticky', async (page) => {
    await page.evaluate(RAISE.failure);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} sticky`, 'the failure toast was not drawn');
    await advance(page, 60000);
    await sleep(120);
    const drew = await page.evaluate(facts);
    if (drew.titles.length !== 1) fail(`lifetime ${where} sticky`, `the failure toast was gone after 60 s: ${JSON.stringify(drew.titles)}`);
    else if (!drew.sticky[0]) fail(`lifetime ${where} sticky`, 'the failure toast is not marked sticky (data-sticky)');
  });

  // The pointer over a toast stops the clock; when it leaves the toast has at least 2 s more.
  await part('pointer', async (page) => {
    await page.evaluate(RAISE.info);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} pointer`, 'the info toast was not drawn');
    await advance(page, 7500);
    const box = await page.locator('[data-notices-part="toast"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await sleep(200);
    await advance(page, 20000);
    await sleep(120);
    if ((await toastCount(page)) !== 1) return fail(`lifetime ${where} pointer`, 'the toast closed while the pointer was over it');
    await page.mouse.move(1, 1, { steps: 3 });
    // The layer asks, 120 ms after the pointer left, whether a toast is under it: the hold is let go then.
    await sleep(500);
    await advance(page, 1999);
    await sleep(120);
    if ((await toastCount(page)) !== 1) fail(`lifetime ${where} pointer`, 'the toast had less than 2 s after the pointer left');
    await advance(page, 8000);
    if (!(await waitStack(page, 0, 3000))) fail(`lifetime ${where} pointer`, 'the toast did not close after the pointer left');
  });

  // The focus in a toast stops the clock the same way.
  await part('focus', async (page) => {
    await page.evaluate(RAISE.info);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} focus`, 'the info toast was not drawn');
    await advance(page, 7500);
    await page.locator('[data-notices-part="toast"] [data-notices-part="dismiss"]').first().focus();
    await sleep(120);
    await advance(page, 20000);
    await sleep(120);
    if ((await toastCount(page)) !== 1) return fail(`lifetime ${where} focus`, 'the toast closed while the focus was in it');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await sleep(120);
    await advance(page, 1999);
    await sleep(120);
    if ((await toastCount(page)) !== 1) fail(`lifetime ${where} focus`, 'the toast had less than 2 s after the focus left');
    await advance(page, 8000);
    if (!(await waitStack(page, 0, 3000))) fail(`lifetime ${where} focus`, 'the toast did not close after the focus left');
  });

  // A toast that is removed under the pointer, or that has the focus, while others stay lets go of the clocks: the engine sends no `pointerout` for a node that is gone, so the layer asks the page again, after it draws, whether a toast
  // is still under the pointer. With no toast left there is nothing to ask, so the scene keeps one.
  await part('gone', async (page) => {
    const paused = () => page.evaluate(() => window.__notices.getSnapshot().toasts.paused);
    const raise = (title) =>
      page.evaluate((text) => {
        window.__notices.forSource(`p-${text}`).notify({ title: text, severity: 'info', initiator: 'system' });
      }, title);
    const dismissFirst = () => page.evaluate(() => window.__notices.dismiss(window.__notices.getSnapshot().toasts.items[0].id));
    await raise('First');
    await raise('Second');
    await settle(page);
    if (!(await waitStack(page, 2))) return fail(`lifetime ${where} gone`, 'the two toasts were not drawn');
    const box = await page.locator('[data-notices-part="toast"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await sleep(200);
    if (!(await paused())) return fail(`lifetime ${where} gone`, 'the pointer over a toast did not hold the clocks');
    await dismissFirst();
    await settle(page);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} gone`, 'the toast under the pointer was not removed');
    await sleep(500);
    if (await paused()) return fail(`lifetime ${where} gone`, 'the clocks are still held after the toast under the pointer was removed');
    await page.mouse.move(1, 1, { steps: 2 });
    await raise('Third');
    await settle(page);
    await waitStack(page, 2);
    await page.locator('[data-notices-part="toast"] [data-notices-part="dismiss"]').first().focus();
    await sleep(200);
    if (!(await paused())) return fail(`lifetime ${where} gone`, 'the focus in a toast did not hold the clocks');
    await dismissFirst();
    await settle(page);
    await waitStack(page, 1);
    await sleep(300);
    if (await paused()) fail(`lifetime ${where} gone`, 'the clocks are still held after the toast that had the focus was removed');
  });

  // A stack that has no room is hidden and nobody can read it, so the clocks wait for it (the lead's ruling, "never lose a message unseen"); when it is home again each toast has what it had left, and at least 2 s. A probe-only
  // button over the whole window takes every room away, as the placement section's yield does. The model's clock is the probe's; the view's 120 ms before it decides again is real.
  await part('yield', async (page) => {
    const paused = () => page.evaluate(() => window.__notices.getSnapshot().toasts.paused);
    const listed = () => page.evaluate(() => window.__notices.getSnapshot().toasts.items.length);
    const placeIs = (wanted) =>
      page.waitForFunction((place) => (document.querySelector('[data-notices-part="host"]')?.getAttribute('data-place') ?? null) === place, wanted, { timeout: WAIT }).then(
        () => true,
        () => false,
      );
    await page.evaluate(RAISE.info);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} yield`, 'the info toast was not drawn');
    await advance(page, 3000);
    await page.evaluate(addControls, [{ label: 'probe: the whole window', left: 0, top: 0, width: viewport.width, height: viewport.height, cover: true }]);
    if (!(await placeIs('yield'))) return fail(`lifetime ${where} yield`, 'the stack did not yield with a control over the whole window');
    await sleep(200);
    const held = await paused();
    await advance(page, 20000);
    await sleep(120);
    const hidden = { paused: held, inTheDom: await toastCount(page), inTheModel: await listed() };
    notes.yield = hidden;
    if (!hidden.paused || hidden.inTheDom !== 1 || hidden.inTheModel !== 1) return fail(`lifetime ${where} yield`, `the clocks did not wait while the stack had no room: ${JSON.stringify(hidden)}, wanted the clocks paused and the toast in the DOM and in the model's list after 20 s hidden`);
    await page.evaluate(() => document.querySelector('[data-probe-holder]')?.remove());
    if (!(await placeIs(null))) return fail(`lifetime ${where} yield`, 'the stack did not come home when the control over the whole window left');
    await sleep(250);
    if (await paused()) return fail(`lifetime ${where} yield`, 'the clocks are still held after the stack came home');
    await advance(page, 4990);
    await sleep(120);
    if ((await toastCount(page)) !== 1) return fail(`lifetime ${where} yield`, 'the toast had less than the 5 s it had left (3 s of its 8 were gone when the stack yielded) after the stack came home');
    await advance(page, 20);
    if (!(await waitStack(page, 0, 3000))) fail(`lifetime ${where} yield`, 'the toast was still there 5 s after the stack came home: it had only 5 s left');
  });

  // A modal (the palette) takes the stack away, and brings it back when it closes, with at least 2 s more; a toast raised while it is open waits for it, and is drawn with the one that was there.
  await part('modal', async (page) => {
    await page.evaluate(RAISE.info);
    if (!(await waitStack(page, 1))) return fail(`lifetime ${where} modal`, 'the info toast was not drawn');
    await advance(page, 7500);
    await page.keyboard.press(await chordOf(page));
    await page.waitForSelector('dialog[open]', { timeout: WAIT });
    await settle(page);
    const during = await page.evaluate(() => ({ hosts: document.querySelectorAll('[data-notices-part="host"]').length, toasts: document.querySelectorAll('[data-notices-part="toast"]').length, layers: document.querySelectorAll('[data-notices-part="layer"]').length }));
    notes.modal = during;
    if (during.hosts !== 0 || during.toasts !== 0) return fail(`lifetime ${where} modal`, `the stack was drawn while the palette was open: ${JSON.stringify(during)}`);
    if (during.layers !== 1) return fail(`lifetime ${where} modal`, `the layer was not there while the palette was open: ${JSON.stringify(during)}`);
    await advance(page, 20000);
    await sleep(120);
    await page.evaluate(RAISE.failure);
    await settle(page);
    if ((await toastCount(page)) !== 0) return fail(`lifetime ${where} modal`, 'a toast raised while the palette was open was drawn');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
    await sleep(200);
    await advance(page, 1999);
    if (!(await waitStack(page, 2, 3000))) return fail(`lifetime ${where} modal`, 'the stack did not come back, with the toast raised meanwhile and at least 2 s, when the palette closed');
    await advance(page, 8000);
    await sleep(200);
    const left = await toastCount(page);
    if (left !== 1) fail(`lifetime ${where} modal`, `after the palette closed the info toast should have closed and the failure stayed: ${left} toasts left, wanted 1`);
  });

  report.lifetime[where] = notes;
}

// ---------------------------------------------------------------------------------------------------------------------------
// What is told, from the DOM: the recorder (above) is installed before the page's own scripts run, on a clock the probe drives.
async function announce(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors } = await scenePage(browser, origin, viewport, 'case=clock', { init: [script(recorder)] });
  const told = () => page.evaluate(() => window.__told.slice());

  // The layer and the window's two live regions are in the DOM before the first notice, empty, and tell nothing by existing.
  const regions = await page.evaluate(() => {
    const read = (part) => {
      const element = document.querySelector(`[data-notices-part="${part}"]`);
      return element === null ? null : { live: element.getAttribute('aria-live'), atomic: element.getAttribute('aria-atomic'), role: element.getAttribute('role'), text: element.textContent };
    };
    return { layer: read('layer'), polite: read('live'), assertive: read('alert'), host: document.querySelector('[data-notices-part="host"]') !== null };
  });
  const { layer, polite, assertive } = regions;
  if (layer === null || layer.live !== 'polite' || layer.atomic !== 'false' || layer.role !== null) fail(`announce ${where}`, `the layer is not a polite live region before the first notice (aria-live, aria-atomic false, no role): ${JSON.stringify(layer)}`);
  if (layer !== null && (layer.text !== '' || regions.host)) fail(`announce ${where}`, `the layer is not empty before the first notice: ${JSON.stringify(regions)}`);
  if (polite === null || polite.live !== 'polite' || polite.role !== null || polite.text !== '') fail(`announce ${where}`, `the window's polite live region is not there, empty, with aria-live and no role, before the first notice: ${JSON.stringify(polite)}`);
  if (assertive === null || assertive.live !== 'assertive' || assertive.role !== null || assertive.text !== '') fail(`announce ${where}`, `the window's assertive live region is not there, empty, with aria-live and no role, before the first notice: ${JSON.stringify(assertive)}`);
  if ((await told()).length !== 0) fail(`announce ${where}`, `something was told before the first notice: ${JSON.stringify(await told())}`);

  // A failure the user caused is told assertively, once, with its severity word first.
  await page.evaluate(RAISE.failure);
  await settle(page);
  await waitStack(page, 1);
  await sleep(200);
  let all = await told();
  const first = all.filter((entry) => entry.text.startsWith('Error: Timed out'));
  const roles = (await page.evaluate(facts)).roles;
  if (first.length !== 1 || first[0].kind !== 'assertive' || roles.join() !== 'alert') fail(`announce ${where}`, `the failure toast was not announced assertively, once, as role=alert (${roles.join()}): ${JSON.stringify(all)}`);

  // An info toast is told politely, once.
  await page.evaluate(() => {
    window.__notices.forSource('p2').notify({ title: 'Connection added', detail: 'prod-east is ready to use.', severity: 'info', initiator: 'system' });
  });
  await settle(page);
  await waitStack(page, 2);
  await sleep(200);
  all = await told();
  const second = all.filter((entry) => entry.text.startsWith('Info: Connection added'));
  if (second.length !== 1 || second[0].kind !== 'polite') fail(`announce ${where}`, `the info toast was not announced politely, once: ${JSON.stringify(all)}`);
  if (all.length !== 2) fail(`announce ${where}`, `a failure and an info toast made ${all.length} announcements, wanted 2: ${JSON.stringify(all)}`);

  // The failure again folds into the toast that is there ("Timed out 2 times"): the words change, and nothing is told again.
  const before = (await told()).length;
  await page.evaluate(RAISE.failure);
  await settle(page);
  await sleep(300);
  const folded = await page.evaluate(facts);
  const after = await told();
  if (!folded.labels.includes('Error: Timed out 2 times')) fail(`announce ${where}`, `the repeat of the failure did not fold into the toast that was there: ${JSON.stringify(folded.labels)}`);
  if (after.length !== before) fail(`announce ${where}`, `the repeat that folded into a toast was told again (${after.length - before} new): ${JSON.stringify(after.slice(before))}`);
  report.announce[where] = { told: after.map((entry) => `${entry.kind} ${entry.via}: ${entry.text}`) };
  pageErrors(where, errors);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the layer costs, in the production build (what a person meets) and the development build (React's Profiler calls its callback there). Counts, never times.
const IDLE = 1000;
const AFTER_CLOSE = 600;

const ACTIONABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="treeitem"], [role="option"]';

/** Every control's box by name, in the page: what must stay where it is while toasts come and go under the layer. */
const rectsOf = (page) =>
  page.evaluate((actionable) => {
    const out = {};
    const layer = document.querySelector('[data-notices-part="layer"]');
    let serial = 0;
    for (const element of document.querySelectorAll(actionable)) {
      if (layer?.contains(element)) continue;
      const box = element.getBoundingClientRect();
      serial += 1;
      out[`${serial} ${(element.getAttribute('aria-label') ?? element.textContent ?? element.tagName).trim().slice(0, 30)}`] = [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 100) / 100).join(',');
    }

    return out;
  }, ACTIONABLE);

async function perf(browser, engine, viewportName, viewport, production, development, only) {
  const where = `${engine} ${viewportName}`;
  const result = { burst: null, commits: null, empty: null, expiry: null };
  report.perf[where] = result;
  const wants = (name) => only === undefined || only.includes(name);

  /** One part in a page of its own, as the palette's perf sections are: a failed step is a failure of the part, the page's errors are failures, and the context is always closed. */
  async function section(name, origin, query, options, body) {
    if (!wants(name)) return;
    let opened;
    try {
      opened = await scenePage(browser, origin, viewport, query, options);
      await body(opened.page);
    } catch (error) {
      fail(`perf ${where} ${name}`, `the scene did not run: ${firstLine(error)}`);
    } finally {
      if (opened !== undefined) {
        for (const message of opened.errors) fail(`perf ${where} ${name}`, `page error: ${message}`);
        await opened.context.close();
      }
    }
  }

  // 1. Fifty notices raised in one tick (production): the stack shows the cap, and nothing under the layer moves while it comes, stays and goes. The page's controls are read before and after; the sampler watches every region of the
  //    window at every frame; Chromium's layout-shift observer adds what the engine measures (WebKit has none, which the report says).
  await section('burst', production.origin, 'case=real', { init: [`window.__probeFrames = 1200; ${SAMPLER}`] }, async (page) => {
    await sleep(600);
    const start = await page.evaluate(() => ({
      frames: window.__probe.frames,
      layoutShift: window.__probe.layoutShift,
      // The harness reads 0 where the engine has no layout-shift observer: that 0 is not a measurement.
      observed: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift'),
    }));
    const rects = await rectsOf(page);
    await page.evaluate(RAISE.burst);
    const drew = await waitStack(page, 3);
    await sleep(600);
    const stack = await page.evaluate(facts);
    if (!drew || stack.summary.join() !== 'true,false,false' || stack.titles.join('|') !== '48 more notifications|Notice 49|Notice 50') fail(`perf ${where} burst`, `50 notices raised in one tick did not show the cap (the summary and the two newest): ${JSON.stringify(stack.titles)}`);
    const during = await rectsOf(page);
    await page.evaluate(() => window.__notices.dismissToasts());
    await waitStack(page, 0);
    await sleep(600);
    const after = await rectsOf(page);
    const probe = await page.evaluate(() => ({ ...window.__probe }));
    const moves = probe.moves.filter((move) => move.frame > start.frames);
    const gone = probe.gone.filter((entry) => entry.frame > start.frames);
    const layoutShift = start.observed && probe.layoutShift !== null ? round(probe.layoutShift - (start.layoutShift ?? 0)) : null;
    const moved = (then) => Object.keys(rects).filter((name) => then[name] !== rects[name]);
    const movedDuring = moved(during);
    const movedAfter = moved(after);
    result.burst = {
      toasts: stack.titles.length,
      controls: Object.keys(rects).length,
      moves: moves.length,
      layoutShift,
      layoutShiftObserved: start.observed,
      measured: start.observed ? 'the controls\' rects and the engine\'s layout-shift observer' : 'the controls\' rects only: this engine has no layout-shift observer',
      frames: probe.frames,
    };
    if (Object.keys(rects).length < 10) fail(`perf ${where} burst`, `only ${Object.keys(rects).length} controls were read: the page's controls were not found`);
    if (movedDuring.length > 0) fail(`perf ${where} burst`, `a control moved when the stack appeared: ${movedDuring.slice(0, 3).map((name) => `${name} ${rects[name]} -> ${during[name]}`).join('; ')}`);
    if (movedAfter.length > 0) fail(`perf ${where} burst`, `a control moved after the stack came and went: ${movedAfter.slice(0, 3).map((name) => `${name} ${rects[name]} -> ${after[name]}`).join('; ')}`);
    if (probe.frames >= 1200) fail(`perf ${where} burst`, "the sampler stopped at its 1200 frames before the end of the scene: the last of it was not watched");
    if (moves.length > 0) fail(`perf ${where} burst`, `${moves.length} regions of the window moved: ${JSON.stringify(moves.slice(0, 4))}`);
    if (gone.length > 0) fail(`perf ${where} burst`, `${gone.length} regions left the DOM: ${JSON.stringify(gone.slice(0, 4))}`);
    if (layoutShift !== null && layoutShift !== 0) fail(`perf ${where} burst`, `layout shift ${layoutShift} while the stack came and went (sources: ${JSON.stringify(probe.shiftSources.slice(0, 6))})`);
  });

  // 2. The commits (development build): the burst costs at most one for each time the model told the view, and the model tells it twice at most (the first change at once, the rest at the end of the frame).
  if (wants('commits')) {
    if (development === null || development === undefined) {
      result.commits = null;
    } else {
      await section('commits', development.origin, 'case=real', {}, async (page) => {
        await sleep(400);
        await page.evaluate(() => {
          window.__flushes = 0;
          window.__notices.subscribe(() => {
            window.__flushes += 1;
          });
        });
        const before = await page.evaluate(() => window.__commits.length);
        await page.evaluate(RAISE.burst);
        const drew = await waitStack(page, 3);
        await sleep(600);
        const counted = await page.evaluate((from) => ({ commits: window.__commits.length - from, flushes: window.__flushes }), before);
        result.commits = counted;
        if (!drew) fail(`perf ${where} commits`, 'the cap was not drawn after the burst');
        if (counted.commits < 1) fail(`perf ${where} commits`, 'the burst made no commit the profiler saw: the development build is not reporting commits');
        if (counted.flushes > 2) fail(`perf ${where} commits`, `the model told the view ${counted.flushes} times for 50 notices raised in one tick, wanted 2 at most`);
        if (counted.commits > counted.flushes) fail(`perf ${where} commits`, `50 notices raised in one tick made ${counted.commits} commits for ${counted.flushes} times the model told the view, wanted at most one for each`);
      });
    }
  }

  // 3. An empty stack holds nothing: what the page holds and has outstanding, before the first toast and after the stack is empty again, and what runs meanwhile. Fonts are left alone (their settling is a timer).
  const kinds = ['timeouts', 'intervals', 'frames', 'idles'];
  const outstanding = (snapshot) => Object.fromEntries(kinds.map((kind) => [kind, snapshot[kind].length]));
  const describe = (entry) => `#${entry.id} ${entry.delay} ms ${entry.stack === '' ? '(no stack)' : entry.stack.slice(0, 200)}`;
  const idle = async (page) => {
    const start = await page.evaluate(() => window.__watch.now());
    const ranBefore = await page.evaluate(() => window.__watch.ran().count);
    await sleep(IDLE);
    const ran = await page.evaluate(() => window.__watch.ran());
    return { count: ran.count - ranBefore, log: ran.log.filter((entry) => entry.at >= start) };
  };
  const held = (snapshot) => new Map(snapshot.held.map((entry) => [entry.key, entry]));
  const show = (entry) => `${entry.key} ${entry.source}`;
  const takeAll = (page) => page.evaluate(() => ({ ...window.__watch.snapshot(), observers: window.__observers() }));
  /** The comparison of the page before the first toast with the page after the stack is empty again: what is held, what is outstanding, what runs. `label` names the way the stack was emptied. */
  async function compareEmpty(label, base, quiet, whileOpen, after, quietAfter, pending) {
    const [before, left] = [held(base), held(after)];
    const added = [...left.values()].filter((entry) => !before.has(entry.key));
    const removed = [...before.values()].filter((entry) => !left.has(entry.key));
    if (added.length > 0) fail(`perf ${where} empty`, `${added.length} registrations on the window or the document that the stack left behind (${label}): ${added.map(show).join('; ')}`);
    if (removed.length > 0) fail(`perf ${where} empty`, `${removed.length} registrations on the window or the document that were there before the first toast and are gone (${label}): ${removed.map(show).join('; ')}`);
    if (after.observers.join() !== base.observers.join()) fail(`perf ${where} empty`, `observers held after the stack was empty (${label}): ${after.observers.join(', ')}; before the first toast: ${base.observers.join(', ')}`);
    const [now, was] = [outstanding(after), outstanding(base)];
    const idsBefore = new Set(kinds.flatMap((kind) => base[kind].map((entry) => `${kind}:${entry.id}`)));
    const started = kinds.flatMap((kind) => after[kind].filter((entry) => !idsBefore.has(`${kind}:${entry.id}`)).map((entry) => ({ kind, ...entry })));
    for (const kind of kinds) {
      if (now[kind] > was[kind]) fail(`perf ${where} empty`, `${now[kind]} ${kind} outstanding after the stack was empty, ${was[kind]} before the first toast (${label}): ${started.filter((entry) => entry.kind === kind).map(describe).join('; ')}`);
    }

    if (quiet.count !== 0) fail(`perf ${where} empty`, `${quiet.count} timer or frame callbacks ran in ${IDLE} ms before the first toast: ${quiet.log.slice(0, 4).map(describe).join('; ')}`);
    if (quietAfter.count !== 0) fail(`perf ${where} empty`, `${quietAfter.count} timer or frame callbacks ran in ${IDLE} ms after the stack was empty (${label}): ${quietAfter.log.slice(0, 4).map(describe).join('; ')}`);
    if (pending !== undefined && pending !== 0) fail(`perf ${where} empty`, `${pending} timers of the model are pending after the stack was empty (${label})`);
    // The instrumentation is tried on the page: a page that holds nothing must be a page that holds nothing, not wrappers that see nothing.
    if (whileOpen.held.length <= base.held.length) fail(`perf ${where} empty`, `the instrumentation saw no registration while the stack was open (${label}): it is not wrapping the page's calls`);
    if (whileOpen.observers.length <= base.observers.length) fail(`perf ${where} empty`, `the instrumentation saw no observer while the stack was open (${label}): it is not wrapping the page's observers`);
    return { held: base.held.length, heldWhileOpen: whileOpen.held.length, observersWhileOpen: whileOpen.observers, timersWhileOpen: outstanding(whileOpen), timersAfter: now, timersBefore: was, callbacksRanBefore: quiet.count, callbacksRanAfter: quietAfter.count, modelTimersPending: pending ?? null };
  }

  // 3a. Emptied by the user, on the platform's timers (the model's own timer for the info toast is a real one here).
  await section('empty', production.origin, 'case=real', { init: [script(watch), script(observers)], font: false }, async (page) => {
    await sleep(800);
    for (const problem of await page.evaluate(() => window.__watch.selfTest())) fail(`perf ${where} empty`, `the instrumentation is wrong: ${problem}`);
    const quiet = await idle(page);
    const base = await takeAll(page);
    if (base.held.length === 0) fail(`perf ${where} empty`, "the instrumentation saw no registration on the window or the document: it is not wrapping the page's calls");
    await page.evaluate(RAISE.both);
    await waitStack(page, 2);
    await sleep(400);
    const whileOpen = await takeAll(page);
    await page.evaluate(() => window.__notices.dismissToasts());
    await waitStack(page, 0);
    await sleep(AFTER_CLOSE);
    const after = await takeAll(page);
    const quietAfter = await idle(page);
    result.empty = await compareEmpty('dismissed by the user', base, quiet, whileOpen, after, quietAfter, undefined);
  });

  // 3b. Emptied by the toasts closing themselves, on the clock the probe drives (its pending timers are the model's own).
  await section('expiry', production.origin, 'case=clock', { init: [script(watch), script(observers)], font: false }, async (page) => {
    await sleep(800);
    const quiet = await idle(page);
    const base = await takeAll(page);
    await page.evaluate(RAISE.both);
    await settle(page);
    await waitStack(page, 2);
    await sleep(400);
    const whileOpen = await takeAll(page);
    const modelWhileOpen = await page.evaluate(() => window.__clock.pending());
    if (modelWhileOpen < 1) fail(`perf ${where} empty`, 'the model held no timer while a toast that closes by itself was drawn: the clock the probe drives is not the model\'s');
    await advance(page, 8000);
    await sleep(200);
    await page.evaluate(() => window.__notices.dismissToasts());
    await settle(page);
    await waitStack(page, 0);
    await sleep(AFTER_CLOSE);
    const after = await takeAll(page);
    const quietAfter = await idle(page);
    const pending = await page.evaluate(() => window.__clock.pending());
    result.expiry = await compareEmpty('closed by themselves and by the user', base, quiet, whileOpen, after, quietAfter, pending);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Where the stack stands (P7, S79). The rule, from the page's side: a toast is never over a control (every control's centre is hit-tested), at home no control is nearer than 4 px, moved none is nearer than 8 (to the
// whole pixel the rule works in), the palette takes the stack away, and a stack with no room is hidden, inert and no stop of F6, told once, and comes home when there is room. What is recorded for each state goes in a table.
const CLEAR = { home: 4, moved: 8 };
/** The rule works in whole pixels (the stack's own box is rounded), so a stack may stand up to half a pixel nearer than the gap it keeps. */
const WHOLE = 0.5;

/** The distance between two boxes [left, top, right, bottom]: the larger of the gaps on the two axes, which is how the rule measures (an expanded box that meets another). Negative while they overlap. */
const distance = (a, b) => Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);

/** Probe-only controls, added to the document as a page's own would be: a button each, at a place. */
function addControls(specs) {
  const holder = document.createElement('div');
  holder.setAttribute('data-probe-holder', '');
  for (const spec of specs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = spec.label;
    button.setAttribute('data-probe-only', spec.label);
    Object.assign(button.style, {
      position: 'fixed',
      left: `${spec.left}px`,
      top: `${spec.top}px`,
      width: `${spec.width}px`,
      height: `${spec.height}px`,
      margin: '0',
      padding: '0',
      border: '1px solid #8b949e',
      background: spec.cover ? 'rgba(248, 81, 73, 0.07)' : '#30363d',
      color: '#e6edf3',
      zIndex: spec.cover ? '1' : 'auto',
    });
    holder.append(button);
  }

  document.body.append(holder);
}

/** Where the focus is, for the scene that hides the stack with the focus in it: the element, and whether it comes before the layer in the document (a control the layer could have given the focus back to). */
function focusFacts() {
  const layer = document.querySelector('[data-notices-part="layer"]');
  const active = document.activeElement;
  return {
    tag: active?.tagName ?? null,
    label: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40),
    region: active?.closest('[data-shell-region]')?.getAttribute('data-shell-region') ?? null,
    part: active?.getAttribute('data-shell-part') ?? active?.getAttribute('data-notices-part') ?? null,
    fixture: active?.getAttribute('data-fixture') ?? null,
    inLayer: active?.closest('[data-notices-part="layer"]') != null,
    first: active != null && active === document.querySelector('[data-notices-part="toast"]'),
    precedes: active != null && layer !== null && active !== document.body && !active.contains(layer) && (active.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  };
}

const PLACE_STATES = ['closed', 'open', 'cap', 'tall', 'palette', 'near', 'column', 'column-open', 'yield', 'yield-focus'];
const STATE_NOTES = {
  closed: 'the real shell, panel closed',
  open: 'the real shell, panel open',
  cap: 'the real shell, panel open, the stack at the cap',
  tall: 'the real shell, panel open, three toasts with buttons: at home the stack would cover the panel\'s Hide button, so it stands beside it',
};
const STATE_SHOTS = { closed: 'home-closed', open: 'home-open', cap: 'home-cap-open', tall: 'moved-panel' };

async function placement(browser, engine, viewportName, viewport, origin, only) {
  const where = `${engine} ${viewportName}`;
  const [width, height] = [viewport.width, viewport.height];
  const read = async (page) => {
    const got = await page.evaluate(readControls, ACTIONABLE);
    const reached = got.controls.filter((control) => control.reached);
    const covered = reached.filter((control) => control.covered).map((control) => control.label);
    let nearest = null;
    if (got.host !== null && got.host.place !== 'yield') {
      // A covered control is the hit test's finding, counted once there: the distances are of the controls that are not under a toast.
      for (const control of reached.filter((entry) => !entry.covered)) {
        const gap = distance(got.host.box, control.box);
        if (nearest === null || gap < nearest.gap) nearest = { label: control.label, gap: round(gap) };
      }
    }

    return { ...got, reached: reached.length, covered, nearest };
  };
  /** The state once the stack has stopped changing: the same reading twice, 150 ms apart (the rule decides again 120 ms after the page changed). */
  const stand = async (page) => {
    let last = JSON.stringify(await read(page));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(150);
      const now = JSON.stringify(await read(page));
      if (now === last) break;
      last = now;
    }

    return JSON.parse(last);
  };
  const rowOf = (state, got, note = '') => {
    const row = {
      engine,
      size: viewportName,
      state,
      place: got.host === null ? 'no stack' : (got.host.place ?? 'home'),
      box: got.host === null ? '' : [got.host.box[0], got.host.box[1], got.host.box[2] - got.host.box[0], got.host.box[3] - got.host.box[1]].map(round).join(','),
      nearest: got.nearest === null ? '' : `${got.nearest.label} (${got.nearest.gap} px)`,
      controls: got.reached,
      covered: got.covered.length,
      note,
    };
    report.placement.push(row);
    return row;
  };
  /** The rule's three findings for a state with a stack drawn at `place`. */
  const judge = (state, got) => {
    const label = `placement ${where} ${state}`;
    if (got.covered.length > 0) fail(label, `a toast covers the centre of ${got.covered.length} controls: ${got.covered.slice(0, 4).join(', ')}`);
    const place = got.host?.place ?? null;
    if (got.host !== null && place !== 'yield' && got.nearest !== null) {
      const rule = place === null ? CLEAR.home : CLEAR.moved;
      if (got.nearest.gap < rule - WHOLE) {
        fail(label, place === null ? `the stack stands at home with a control ${got.nearest.gap} px from it (nearer than ${rule} px): ${got.nearest.label}` : `the stack was moved and stands ${got.nearest.gap} px from ${got.nearest.label} (nearer than ${rule} px)`);
      }
    }
  };
  const expectPlace = (state, got, wanted) => {
    const place = got.host === null ? 'no stack' : (got.host.place ?? 'home');
    if (place !== wanted) fail(`placement ${where} ${state}`, `the stack is ${place}, wanted ${wanted}`);
  };

  for (const state of only ?? PLACE_STATES) {
    const label = `placement ${where} ${state}`;
    const { page, context, errors } = await scenePage(browser, origin, viewport, 'case=real', { init: [script(recorder)] });
    try {
      if (state === 'open' || state === 'cap' || state === 'tall' || state === 'column-open') {
        await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
        await sleep(400);
      }

      await page.evaluate(state === 'cap' ? RAISE.errors : state === 'tall' ? RAISE.three : RAISE.pair);
      const toasts = state === 'cap' || state === 'tall' ? 3 : 2;
      if (!(await waitStack(page, toasts))) fail(label, `the stack of ${toasts} toasts was not drawn`);
      await sleep(300);

      if (state === 'closed' || state === 'open' || state === 'cap' || state === 'tall') {
        // The real shell: its own controls decide. Two toasts and the stack at the cap stand at home; three toasts with buttons are as tall as a stack gets, and with the panel open they would cover the panel's own Hide button: the
        // stack stands beside it.
        const got = await stand(page);
        judge(state, got);
        expectPlace(state, got, state === 'tall' ? 'moved' : 'home');
        rowOf(state, got, STATE_NOTES[state]);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-${STATE_SHOTS[state]}-${engine}-${viewportName}.png`) });
      } else if (state === 'palette') {
        // The palette is a modal: the model takes the stack away (no host, no toast), and gives it back when the palette closes.
        const home = await stand(page);
        await page.keyboard.press(await chordOf(page));
        await page.waitForSelector('dialog[open]', { timeout: WAIT });
        const gone = await page.waitForFunction(() => document.querySelector('[data-notices-part="host"]') === null, null, { timeout: 3000 }).then(
          () => true,
          () => false,
        );
        await sleep(300);
        const during = await page.evaluate(() => ({ hosts: document.querySelectorAll('[data-notices-part="host"]').length, toasts: document.querySelectorAll('[data-notices-part="toast"]').length, layers: document.querySelectorAll('[data-notices-part="layer"]').length }));
        if (!gone || during.hosts !== 0 || during.toasts !== 0) fail(label, `the stack was drawn while the palette was open: ${JSON.stringify(during)}`);
        const palette = await stand(page);
        rowOf(state, palette, 'the palette open: no host, no toast');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-palette-${engine}-${viewportName}.png`) });
        await page.keyboard.press('Escape');
        await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
        const back = await waitStack(page, toasts);
        if (!back) fail(label, 'the stack did not come back when the palette closed');
        const returned = await stand(page);
        judge('palette closed', returned);
        expectPlace('palette closed', returned, 'home');
        if (JSON.stringify(returned.host?.box) !== JSON.stringify(home.host?.box)) fail(label, `the stack came back to ${JSON.stringify(returned.host?.box)}, it stood at ${JSON.stringify(home.host?.box)}`);
        rowOf('palette closed', returned, 'the palette closed: the stack is back where it was');
      } else if (state === 'near') {
        // A control 2 px from where the stack stands at home: the stack moves for it (nearer than 4 px is a conflict), and no control is nearer to it than 8.
        const home = await stand(page);
        if (home.host === null || home.layer === null) throw new Error('the stack has no box at home');
        const left = home.layer[0];
        const top = home.layer[3] - (home.host.box[3] - home.host.box[1]);
        await page.evaluate(addControls, [{ label: 'probe: 2 px from home', left: left - 2 - 28, top: top + 24, width: 28, height: 28 }]);
        const got = await stand(page);
        judge(state, got);
        rowOf(state, got, 'a probe-only button 2 px from the stack at home');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-moved-near-${engine}-${viewportName}.png`) });
      } else if (state === 'column' || state === 'column-open') {
        // A column of row buttons along the right edge (a table's row actions): the stack moves to the left of it, 8 px clear.
        await page.evaluate(
          addControls,
          Array.from({ length: 12 }, (_, index) => ({ label: `row ${index + 1}`, left: width - 40, top: 320 + index * 40, width: 28, height: 28 })),
        );
        const got = await stand(page);
        judge(state, got);
        expectPlace(state, got, 'moved');
        rowOf(state, got, state === 'column' ? 'a probe-only column of row buttons at the right edge, panel closed' : 'the same column, panel open: the stack stands beside it, over the panel');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-moved-column-${state === 'column' ? 'closed' : 'open'}-${engine}-${viewportName}.png`) });
      } else if (state === 'yield-focus') {
        // The focus is in the stack when it yields. The stack becomes inert, which the engine answers by dropping the focus to the body; the layer gives it back first (S12: a layer that goes never drops the focus), to the control it
        // came from, and, when that is gone, to the nearest control before the stack in the document (the mock's `rescueFocus`): never to the body, never left in the stack. Two runs in one page: the control it came from kept, and removed.
        const here = () => page.evaluate(focusFacts);
        const placeIs = (wanted) =>
          page.waitForFunction((place) => (document.querySelector('[data-notices-part="host"]')?.getAttribute('data-place') ?? null) === place, wanted, { timeout: WAIT }).then(
            () => true,
            () => false,
          );
        const named = (found) => `${found.tag} "${found.label}" (region ${found.region}, part ${found.part})`;
        /** From the control `selector`, F6 until the first toast has the focus: the origin the layer will give it back to. */
        const enter = async (selector) => {
          await page.locator(selector).focus();
          for (let press = 0; press < 12; press += 1) {
            await page.keyboard.press('F6');
            await sleep(60);
            if ((await here()).first) return true;
          }

          return false;
        };
        for (const [run, short, selector, removed] of [['the control it came from kept', 'origin kept', '[data-fixture="page-control"]', false], ['the control it came from removed', 'origin gone', '[data-fixture="page-other"]', true]]) {
          if (!(await enter(selector))) {
            fail(label, `F6 did not bring the focus into the first toast (${run})`);
            break;
          }

          if (removed) await page.evaluate((target) => document.querySelector(target)?.remove(), selector);
          await page.evaluate(addControls, [{ label: 'probe: the whole window', left: 0, top: 0, width, height, cover: true }]);
          if (!(await placeIs('yield'))) {
            fail(label, `the stack did not yield with a control over the whole window (${run})`);
            break;
          }

          await sleep(300);
          const found = await here();
          const got = await stand(page);
          judge(state, got);
          const right = removed ? found.tag !== 'BODY' && !found.inLayer && found.precedes : found.fixture === 'page-control';
          if (!right) fail(label, `the focus was lost when the stack yielded (${run}): it is on ${named(found)}, wanted ${removed ? 'a control that comes before the stack in the document' : 'the control it came from (page-control)'}`);
          if (got.host !== null && (got.host.visibility !== 'hidden' || !got.host.inert)) fail(label, `the yielded stack is not hidden and inert (${run}): ${JSON.stringify(got.host)}`);
          if (got.host !== null && got.host.region !== null) fail(label, `the yielded stack is still a region of F6 (${run}): data-shell-region=${got.host.region}`);
          rowOf(`yield-focus: ${short}`, got, `the focus was in the stack when it yielded (${run}): it went to ${named(found)}`);
          await page.evaluate(() => document.querySelector('[data-probe-holder]')?.remove());
          if (!(await placeIs(null))) {
            fail(label, `the stack did not come home when the control over the whole window left (${run})`);
            break;
          }

          await sleep(300);
        }
      } else if (state === 'yield') {
        // A control over the whole window: no room anywhere. The stack is hidden, inert and no stop of F6, and tells once; when the control goes, the stack comes home.
        const told = () => page.evaluate(() => window.__told.slice());
        const said = () => page.evaluate(() => window.__announced.slice());
        const [toldBefore, saidBefore] = [(await told()).length, (await said()).length];
        await page.evaluate(addControls, [{ label: 'probe: the whole window', left: 0, top: 0, width, height, cover: true }]);
        const yielded = await page.waitForFunction(() => document.querySelector('[data-notices-part="host"]')?.getAttribute('data-place') === 'yield', null, { timeout: WAIT }).then(
          () => true,
          () => false,
        );
        await sleep(400);
        const got = await stand(page);
        judge(state, got);
        if (!yielded) fail(label, `the stack did not yield with a control over the whole window: data-place=${got.host?.place ?? 'absent'}`);
        if (got.host !== null && yielded) {
          if (got.host.visibility !== 'hidden') fail(label, `the yielded stack is not hidden (visibility: ${got.host.visibility})`);
          if (!got.host.inert) fail(label, 'the yielded stack is not inert');
          if (got.host.region !== null) fail(label, `the yielded stack is still a region of F6 (data-shell-region=${got.host.region})`);
        }

        const stops = (await cycle(page)).map((stop) => stop.region);
        if (stops.includes('toasts') || (await page.evaluate(describeFocus)).inLayer) fail(label, `F6 reached the yielded stack: ${stops.join(' > ')}`);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        const first = (await told()).slice(toldBefore);
        const firstSaid = (await said()).slice(saidBefore);
        const live = first.filter((entry) => entry.via === 'live');
        if (live.length !== 1 || first.length !== 1 || firstSaid.length !== 1 || live[0].text !== firstSaid[0].text || live[0].kind !== firstSaid[0].kind) {
          fail(label, `the stack that yielded was not told exactly once: the live regions carried ${JSON.stringify(first)}, the model was asked to say ${JSON.stringify(firstSaid)}`);
        } else if (live[0].text !== '2 new notifications.' || live[0].kind !== 'assertive') {
          fail(label, `the stack that yielded was told ${JSON.stringify(live[0])}, wanted "2 new notifications." assertively (one of the two is an error the user caused)`);
        }

        // A toast raised while the stack has no room is told once, in its own words: the layer cannot say it, nobody sees it.
        await page.evaluate(() => {
          window.__notices.forSource('p3').notify({ title: 'Snapshot created', severity: 'success', initiator: 'system' });
        });
        await sleep(400);
        const second = (await told()).slice(toldBefore + first.length);
        const secondSaid = (await said()).slice(saidBefore + firstSaid.length);
        if (second.length !== 1 || second[0].via !== 'live' || second[0].kind !== 'polite' || second[0].text !== 'Success: Snapshot created' || secondSaid.length !== 1) {
          fail(label, `a toast raised while the stack yielded was not told once, politely, in its own words: ${JSON.stringify(second)}, the model was asked to say ${JSON.stringify(secondSaid)}`);
        }

        rowOf(state, got, `a probe-only button over the whole window: the stack yields, told "${live[0]?.text ?? ''}" and "${second[0]?.text ?? ''}"`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `toast-yield-${engine}-${viewportName}.png`) });
        const totalBefore = (await told()).length;
        await page.evaluate(() => document.querySelector('[data-probe-holder]')?.remove());
        const home = await page.waitForFunction(() => document.querySelector('[data-notices-part="host"]')?.getAttribute('data-place') === null, null, { timeout: WAIT }).then(
          () => true,
          () => false,
        );
        await sleep(300);
        const returned = await stand(page);
        if (!home || returned.host?.place !== null) fail(label, `the stack did not come home when the control left: data-place=${returned.host?.place ?? 'absent'}`);
        if (returned.host !== null && (returned.host.visibility !== 'visible' || returned.host.inert || returned.host.region !== 'toasts')) fail(label, `the stack at home again is not visible, active and a region of F6: ${JSON.stringify(returned.host)}`);
        if ((await told()).length !== totalBefore) fail(label, `the stack coming home was told again: ${JSON.stringify((await told()).slice(totalBefore))}`);
        const after = (await cycle(page)).map((stop) => stop.region);
        if (after.at(-1) !== 'toasts') fail(label, `the stack at home again is not the last stop of F6: ${after.join(' > ')}`);
        judge('yield: home again', returned);
        rowOf('yield: home again', returned, 'the control gone: the stack is home');
      }
    } catch (error) {
      fail(label, `the scene did not run: ${firstLine(error)}`);
    } finally {
      pageErrors(`${where} ${state}`, errors);
      await context.close();
    }
  }
}

/** The outcomes, as a table: the one the status file copies. */
function placementTable(rows) {
  const heads = ['engine', 'size', 'state', 'place', 'stack box x,y,w,h', 'nearest control', 'controls', 'covered'];
  const cells = rows.map((row) => [row.engine, row.size, row.state, row.place, row.box, row.nearest, String(row.controls), String(row.covered)]);
  const widths = heads.map((head, index) => Math.max(head.length, ...cells.map((cell) => cell[index].length)));
  const line = (cell) => `| ${cell.map((text, index) => text.padEnd(widths[index])).join(' | ')} |`;
  return [line(heads), `|${widths.map((size) => '-'.repeat(size + 2)).join('|')}|`, ...cells.map(line)].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------
// The notification centre (O1b-2): the bell in the status bar and the popover of history it opens, on the fixture's `centre=1` window with a history it starts with (`seed=`), against the mock's own centre (mock-notice-centre.json,
// made by mock-notice-centre-measure.mjs from the mock in eleven scenes, in both engines at both sizes). The mock's words are the shell's; the model's rules are the shell's (core/notices/README.md).
const centreMock = JSON.parse(readFileSync(path.join(here, 'mock-notice-centre.json'), 'utf8'));
const CENTRE = '[data-notices-part="centre"]';
const BELL = '[data-notices-part="bell"]';

/**
 * What the shell does not draw, by the lead's decision (docs/ui-next/status/O1b-2.md, "Differences from the mock", 1): the segmented view above the tools (a 28 px control and an 8 px gap) and the footer under the list (33 px), and
 * the Filter menu's severity group (a 24 px title, five 24 px rows and a separator of 9 px). Every box below the view control is therefore 36 px higher than the mock's, the body is 33 px taller and the menu is 153 px shorter. The
 * probe moves the MOCK's boxes by these, says how many comparisons each moved (`classes.view`, `footer`, `severity`) and compares the rest in full, within a pixel; nothing is loosened to hide them.
 */
const VIEW = 36;
const FOOTER = 33;
const SEVERITY = 153;
/** The parts the segmented view's row pushes down in the mock (everything of the bar from the tools on, and the list under it). The bar's own height and the body's are moved by hand. */
const BELOW_VIEW = ['centreTools', 'centreTool', 'centreNote', 'centreNoteText', 'centreNoteButton', 'centreList', 'centreLabel', 'row', 'rowToggle', 'rowGlyph', 'rowTitle', 'rowText', 'rowTime', 'rowDot', 'rowDismiss', 'rowDetail', 'rowActions', 'rowAction', 'centreEmpty', 'centreEmptyIcon', 'centreEmptyTitle', 'centreEmptyHint'];

/** The scenes of the mock's reading (centre-targets.mjs SCENES), made on the shell: the fixture's seed, what is raised live, and what is done to the window (every step the mock's own scene does). */
const CENTRE_SCENES = {
  closed: { query: 'case=real&centre=1' },
  'bell-info': { query: 'case=real&centre=1&seed=bell-info' },
  'bell-warning': { query: 'case=real&centre=1&seed=bell-warning' },
  'bell-error': { query: 'case=real&centre=1&seed=bell-error' },
  empty: { query: 'case=real&centre=1', open: true },
  list: { query: 'case=real&centre=1&seed=list', open: true },
  // The failed operation with its Retry is the newest record, raised live (a restored record has no code behind its actions), and the person opens its row.
  expanded: { query: 'case=real&centre=1&seed=expanded', live: 'retry', open: true, expand: true },
  filtered: { query: 'case=real&centre=1&seed=list', filter: 'p1', open: true },
  muted: { query: 'case=real&centre=1&seed=muted', open: true },
  menu: { query: 'case=real&centre=1&seed=list', filter: 'p1', open: true, menu: true },
  dots: { query: 'case=real&centre=1&seed=dots', open: true },
};

/** What the page is asked to hold before a scene is read: the live record of the scene `expanded`. */
const CENTRE_LIVE = {
  retry: () => {
    window.__notices.forSource('p1').notify({
      title: 'Timed out',
      detail: 'The cluster did not complete the request in time.',
      severity: 'error',
      initiator: 'system',
      actions: [{ id: 'again', label: 'Retry', icon: 'refresh', primary: true, run: () => undefined }],
    });
  },
};

/** Waits for the popover to be open (`:popover-open`). */
const centreOpen = (page) => page.waitForSelector(`${CENTRE}:popover-open`, { timeout: WAIT });

/** Makes a scene on a fresh page, as the mock's scene is made: the live record, the filter, the centre opened as a script opens it (`Shell.feedback.openCenter()`), the row opened by a click, the Filter menu by a click. */
async function centreScene(page, scene) {
  const spec = CENTRE_SCENES[scene];
  await page.mouse.move(1, 1);
  if (spec.live !== undefined) await page.evaluate(CENTRE_LIVE[spec.live]);
  if (spec.filter !== undefined) await page.evaluate((source) => window.__centreControl.filter(source), spec.filter);
  if (spec.open === true) {
    await page.evaluate(() => window.__centreControl.open());
    await centreOpen(page);
  }

  if (spec.expand === true) await page.click('[data-notices-part="row"] [data-notices-part="rowToggle"]');
  if (spec.menu === true) {
    await page.click('[data-notices-part="filter"]');
    await page.waitForSelector('[data-notices-part="filterMenu"]:popover-open', { timeout: WAIT });
  }

  await page.mouse.move(1, 1);
  await sleep(300);
}

/** What the centre drew, in the words the probe judges it by (the page's side): the bell, the dialog, its tools, notes, headings, rows, empty state and menu. */
function centreFacts() {
  const attr = (element, name) => element?.getAttribute(name) ?? null;
  const within = (scope, name) => scope?.querySelector(`[data-notices-part="${name}"]`) ?? null;
  const all = (scope, name) => [...(scope?.querySelectorAll(`[data-notices-part="${name}"]`) ?? [])];
  // The words an element draws itself, without the severity word that is read and not drawn, and without the reason a disabled button hides.
  const own = (element) => [...(element?.childNodes ?? [])].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim();
  const words = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const centre = document.querySelector('[data-notices-part="centre"]');
  const bell = document.querySelector('[data-notices-part="bell"]');
  const dot = document.querySelector('[data-notices-part="bellDot"]');
  const menu = document.querySelector('[data-notices-part="filterMenu"]');
  const empty = within(centre, 'centreEmpty');
  return {
    toasts: document.querySelectorAll('[data-notices-part="toast"]').length,
    centres: document.querySelectorAll('[data-notices-part="centre"]').length,
    bell: bell === null ? null : { name: attr(bell, 'aria-label'), tip: attr(bell, 'data-ov-tip'), expanded: attr(bell, 'aria-expanded'), haspopup: attr(bell, 'aria-haspopup'), dot: dot === null ? null : attr(dot, 'data-tone'), dotText: dot === null ? null : words(dot) },
    open: centre !== null && centre.matches(':popover-open'),
    name: attr(centre, 'aria-label'),
    role: attr(centre, 'role'),
    title: centre === null ? null : words(within(centre, 'centreTitle')),
    tools: all(within(centre, 'centreTools'), 'centreTool').concat(all(centre, 'filter')).map((button) => ({ text: own(button), disabled: attr(button, 'aria-disabled'), haspopup: attr(button, 'aria-haspopup'), expanded: attr(button, 'aria-expanded') })),
    notes: all(centre, 'centreNote').map((note) => ({ text: words(within(note, 'centreNoteText')), button: words(within(note, 'centreNoteButton')) })),
    labels: all(centre, 'centreLabel').map(words),
    rows: all(centre, 'row').map((row) => ({
      title: own(within(row, 'rowTitle')),
      message: within(row, 'rowText') === null ? null : words(within(row, 'rowText')),
      severity: attr(row, 'data-severity'),
      unread: row.hasAttribute('data-unread'),
      expanded: row.hasAttribute('data-expanded'),
      toggleExpanded: attr(within(row, 'rowToggle'), 'aria-expanded'),
      actions: [...row.querySelectorAll('[data-notices-part="rowActions"] button')].map((button) => attr(button, 'aria-label') ?? words(button)),
    })),
    empty: empty === null ? null : { title: words(within(empty, 'centreEmptyTitle')), hint: words(within(empty, 'centreEmptyHint')), icon: within(empty, 'centreEmptyIcon') !== null },
    menu:
      menu === null
        ? null
        : { name: attr(menu, 'aria-label'), role: attr(menu, 'role'), items: all(menu, 'filterItem').map((item) => ({ label: words(item), role: attr(item, 'role'), checked: attr(item, 'aria-checked') })) },
  };
}

/** The mock's box as the shell, which has no view control and no footer, draws it: `[box, which]`, `which` the difference it was moved by (a hidden box, all zeros, is left where it is). */
function centreAim(name, box) {
  const [x, y, w, h] = box;
  if (box.every((value) => value === 0)) return [box, null];
  if (name === 'centreBar') return [[x, y, w, h - VIEW], 'view'];
  if (name === 'centreBody') return [[x, y, w, h + FOOTER], 'footer'];
  if (name === 'centreScroll') return [[x, y - VIEW, w, h + VIEW + FOOTER], 'view'];
  return BELOW_VIEW.includes(name) ? [[x, y - VIEW, w, h], 'view'] : [box, null];
}

/**
 * How a box whose width follows its words is compared, by the edge the layout holds: `start` (the left edge), `end` (the right edge), `centre` (the middle), `after` (the gap to the box before it, which its place follows), and
 * `gap` (the same, with its own width compared: a 24 px control after a button). Every other box is compared in full. A runner draws another font than the one the mock was measured with, so these widths are printed and not judged.
 */
function centreFollow(scene, name, index) {
  if (name === 'centreTitle' || name === 'rowTitle' || name === 'centreNoteText') return 'start';
  if (name === 'centreNoteButton') return 'end';
  if (name === 'centreEmptyTitle' || name === 'centreEmptyHint') return 'centre';
  if (name === 'centreTool') return ['start', 'after', 'end'][index];
  if (scene === 'expanded' && name === 'rowAction') return index === 0 ? 'start' : index === 1 ? 'gap' : undefined;
  if (scene === 'expanded' && name === 'rowDismiss' && index === 0) return 'gap';
  return undefined;
}

/** The box before this one, whose right edge its place follows: the previous tool of the bar, or the Retry before the Dismiss of an open row. */
const centrePrevious = (name, index) => (name === 'centreTool' ? ['centreTool', index - 1] : ['rowAction', 0]);

/** The mock's rectangles against the shell's, scene by scene (see VIEW). `classes` counts the comparisons by what they are of; `widths` prints both widths of every box that follows its words. */
function compareCentre(scene, mock, shell) {
  const problems = [];
  const classes = { full: 0, words: 0, view: 0, footer: 0, severity: 0, absent: 0 };
  const widths = {};
  let worst = 0;
  const off = (label, key, want, got) => {
    const delta = round(Math.abs(want - got));
    worst = Math.max(worst, delta);
    if (delta > TOLERANCE) problems.push(`${label}[${key}]: mock ${round(want)} shell ${round(got)} (off by ${delta})`);
  };
  const drawn = (box) => box.some((value) => value !== 0);
  for (const part of CENTRE_PARTS) {
    if (part.name === 'centreMenu' || part.name === 'centreMenuItem') continue;
    const wanted = partsOf(mock, part.name);
    const got = shell[part.name] ?? [];
    if (part.shell === null) {
      // The mock's view control and footer. The shell has built neither.
      if (got.length > 0) problems.push(`${part.name}: the shell draws ${got.length} of what it has not built`);
      classes.absent += wanted.filter(drawn).length;
      continue;
    }

    if (got.length === 0 && wanted.length > 0 && !wanted.some(drawn)) {
      // In the mock's DOM and not drawn there, where the shell draws nothing at all: a closed centre is not in the document.
      classes.absent += wanted.length;
      continue;
    }

    if (got.length !== wanted.length) {
      problems.push(`${part.name}: ${got.length} drawn, the mock's scene has ${wanted.length}`);
      continue;
    }

    wanted.forEach((box, index) => {
      const label = `${part.name}${part.all === true ? ` ${index + 1}` : ''}`;
      const [aimed, moved] = centreAim(part.name, box);
      const [x, y, w, h] = aimed;
      const [sx, sy, sw, sh] = got[index];
      const mode = centreFollow(scene, part.name, index);
      if (moved !== null) classes[moved] += 1;
      if (mode === undefined) {
        classes.full += 1;
        off(label, 'x', x, sx);
        off(label, 'y', y, sy);
        off(label, 'w', w, sw);
        off(label, 'h', h, sh);
        return;
      }

      classes.words += 1;
      off(label, 'y', y, sy);
      off(label, 'h', h, sh);
      if (mode === 'start') off(label, 'x', x, sx);
      else if (mode === 'end') off(label, 'right', x + w, sx + sw);
      else if (mode === 'centre') off(label, 'middle', x + w / 2, sx + sw / 2);
      else {
        const [name, before] = centrePrevious(part.name, index);
        const [px, , pw] = partsOf(mock, name)[before];
        const [spx, , spw] = shell[name][before];
        off(label, 'gap', x - (px + pw), sx - (spx + spw));
        if (mode === 'gap') off(label, 'w', w, sw);
      }

      if (mode !== 'gap') widths[label] = [w, sw];
    });
  }

  const menu = compareCentreMenu(mock, shell, off, classes);
  return { problems, worst, classes, widths: { ...widths, ...menu.widths } };
}

const partsOf = (parts, name) => parts[name] ?? [];

/**
 * The Filter menu against the mock's: below the Filter button (4 px) and on its right edge, as tall as the mock's less the severity group, and each item inside it at the same place and as wide as the menu less its 18 px (the menu
 * is as wide as its longest word, so everything is read from the menu's own edges). The shell's six items are the mock's first four, and its last two; the mock's other five (the severity group) are not built.
 */
function compareCentreMenu(mock, shell, off, classes) {
  const widths = {};
  const wanted = partsOf(mock, 'centreMenu');
  const got = shell.centreMenu ?? [];
  if (wanted.length === 0 && got.length === 0) return { widths };
  if (wanted.length !== got.length || got.length !== 1) {
    off('menu', 'drawn', wanted.length, got.length);
    return { widths };
  }

  const [mx, my, mw, mh] = wanted[0];
  const [sx, sy, sw, sh] = got[0];
  const mockFilter = partsOf(mock, 'centreTool')[2];
  const shellFilter = shell.centreTool[2];
  classes.full += 1;
  classes.words += 1;
  classes.severity += 1;
  off('menu', 'below the Filter button', my - (mockFilter[1] + mockFilter[3]), sy - (shellFilter[1] + shellFilter[3]));
  off('menu', 'right edge on the Filter button\'s', mx + mw - (mockFilter[0] + mockFilter[2]), sx + sw - (shellFilter[0] + shellFilter[2]));
  off('menu', 'h', mh - SEVERITY, sh);
  widths.menu = [mw, sw];
  const mockItems = partsOf(mock, 'centreMenuItem');
  const shellItems = shell.centreMenuItem ?? [];
  if (shellItems.length !== mockItems.length - 5) off('menu items', 'count', mockItems.length - 5, shellItems.length);
  shellItems.forEach((item, index) => {
    const at = index < 4 ? index : index + 5;
    const box = mockItems[at];
    if (box === undefined) return;
    const label = `menu item ${index + 1}`;
    classes.full += 1;
    if (at >= 9) classes.severity += 1;
    off(label, 'x from the menu', box[0] - mx, item[0] - sx);
    off(label, 'y from the menu', box[1] - my - (at >= 9 ? SEVERITY : 0), item[1] - sy);
    off(label, 'w from the menu', mw - box[2], sw - item[2]);
    off(label, 'h', box[3], item[3]);
  });
  classes.absent += Math.max(0, mockItems.length - shellItems.length);
  return { widths };
}

/** Style properties that are not compared, with the reason: the menu is as wide as its longest word (a runner draws another font) and 153 px shorter than the mock's, which has the severity group. */
const CENTRE_PAINT_SKIP = { menu: { centreMenu: ['width', 'height'] } };

/**
 * What the mock's scene says once the person has opened a row, which the mock's scene does not do but sets (S81: opening a row, or closing it, is acting on it, so the record is read): the first row has no unread mark, the
 * bell counts one record less and its dot is the colour of what is left. The mock's own words and paint for each of those are used (its read row, the scene `muted` whose error is muted, the scene `bell-warning`).
 */
function centreExpected(rows, scene) {
  const { facts, styles } = rows[scene];
  if (scene !== 'expanded') return { facts, styles };
  return {
    facts: { ...facts, bell: rows.muted.facts.bell, rows: facts.rows.map((row, index) => (index === 0 ? { ...row, unread: false } : row)) },
    styles: { ...styles, bellDot: rows['bell-warning'].styles.bellDot, 'rowDot#0': { ...styles['rowDot#0'], backgroundColor: rows.list.styles['rowDot#2'].backgroundColor } },
  };
}

/** The paint of one scene: every style entry the mock has for it, compared exactly (the entries of what the shell has not built are counted and left). */
function paintCentre(scene, mock, shell) {
  const problems = [];
  let compared = 0;
  let absent = 0;
  let skipped = 0;
  for (const [name, wanted] of Object.entries(mock)) {
    if (CENTRE_PARTS.find((part) => part.name === name.split('#')[0])?.shell === null) {
      absent += Object.keys(wanted).length;
      continue;
    }

    const got = shell[name];
    if (got === undefined) {
      // A closed centre is not in the document: the mock's hidden popover has a style, the shell has no popover to have one.
      if (CENTRE_SCENES[scene].open === true) problems.push(`${name}: the shell does not draw it`);
      else absent += Object.keys(wanted).length;
      continue;
    }

    for (const [prop, value] of Object.entries(wanted)) {
      if (CENTRE_PAINT_SKIP[scene]?.[name]?.includes(prop)) {
        skipped += 1;
        continue;
      }

      compared += 1;
      if (got[prop] !== value) problems.push(`${name} ${prop}: mock ${value} shell ${got[prop]}`);
    }
  }

  return { problems, compared, absent, skipped };
}

/** The words of a scene against the mock's own (its facts): what each part says, which is what makes the boxes above comparable. */
function checkCentreFacts(scene, mock, drew) {
  const problems = [];
  const said = (what, want, got) => {
    if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`${what}: mock ${JSON.stringify(want)} shell ${JSON.stringify(got)}`);
  };
  const space = (text) => (text ?? '').replace(/\s+/g, ' ');
  const open = CENTRE_SCENES[scene].open === true;
  if (drew.toasts !== 0) problems.push(`${drew.toasts} toasts stand over the scene`);
  if (drew.centres !== (open ? 1 : 0)) problems.push(`${drew.centres} centres are in the document, wanted ${open ? 1 : 0} (a closed centre is not drawn at all)`);
  said('the bell\'s name', mock.bell.ariaLabel, drew.bell?.name);
  said('the bell\'s tip', mock.bell.tooltip, drew.bell?.tip);
  said('the bell\'s popup', mock.bell.haspopup, drew.bell?.haspopup);
  said('the bell\'s expanded state', mock.bell.expanded, drew.bell?.expanded);
  said('the bell\'s dot', mock.bell.dot, drew.bell?.dot);
  if (drew.bell?.dotText !== null && drew.bell?.dotText !== '') problems.push(`the bell's dot holds ${JSON.stringify(drew.bell.dotText)}: it is never a number`);
  if (!open) return problems;
  said('the dialog\'s name, role and state', [mock.popover.ariaLabel, mock.popover.role, mock.popover.open], [drew.name, drew.role, drew.open]);
  said('the header', mock.title, drew.title);
  said('the tools', mock.tools.map((tool) => [tool.text, tool.disabled === 'true']), drew.tools.map((tool) => [tool.text, tool.disabled === 'true']));
  said('the tools\' menu button', [mock.tools.at(-1).haspopup, mock.tools.at(-1).expanded], [drew.tools.at(-1)?.haspopup, drew.tools.at(-1)?.expanded]);
  said('the notes', mock.notes.map((note) => ({ text: space(note.text), button: note.button })), drew.notes.map((note) => ({ text: space(note.text), button: note.button })));
  said('the headings', mock.labels, drew.labels);
  said('the rows\' titles', mock.rows.map((row) => row.title), drew.rows.map((row) => row.title));
  said('the rows\' sentences', mock.rows.map((row) => row.message), drew.rows.map((row) => row.message));
  said('the rows\' severities', mock.rows.map((row) => row.severity), drew.rows.map((row) => row.severity));
  said('the rows\' unread marks', mock.rows.map((row) => row.unread), drew.rows.map((row) => row.unread));
  said('the rows\' open states', mock.rows.map((row) => row.expanded), drew.rows.map((row) => row.expanded));
  said('the rows\' titles say whether they are open', mock.rows.map((row) => row.toggleExpanded), drew.rows.map((row) => row.toggleExpanded));
  said('the rows\' buttons', mock.rows.map((row) => row.actions.map((action) => action.name)), drew.rows.map((row) => row.actions));
  if (mock.empty !== null) said('the empty state', { title: mock.empty.title, hint: mock.empty.hint, icon: mock.empty.icon }, drew.empty);
  else if (drew.empty !== null) problems.push(`the shell draws an empty state the mock does not: ${JSON.stringify(drew.empty)}`);
  if (mock.menu !== null) {
    const items = (list) => list.map((item) => [item.label, item.role, item.checked]);
    const shellItems = items(drew.menu?.items ?? []);
    const mockItems = items(mock.menu.items);
    said('the Filter menu\'s name and role', [mock.menu.label, mock.menu.role], [drew.menu?.name, drew.menu?.role]);
    // The severity group (the mock's items 5 to 9) is not built: the mock's source group and its last two items are the shell's six.
    said('the Filter menu\'s items', [...mockItems.slice(0, 4), ...mockItems.slice(9)], shellItems);
  } else if (drew.menu !== null) problems.push('a Filter menu is open that the mock\'s scene does not have');
  return problems;
}

/** The geometry, the paint and the words of the mock's scenes on the shell, with the pictures when SHOTS is set. */
async function centreGeometry(browser, engine, viewportName, viewport, origin, only) {
  const rows = centreMock.data[engine][viewportName];
  for (const scene of only ?? Object.keys(CENTRE_SCENES)) {
    const where = `${engine} ${viewportName} ${scene}`;
    let opened;
    try {
      opened = await scenePage(browser, origin, viewport, CENTRE_SCENES[scene].query);
      const { page } = opened;
      await centreScene(page, scene);
      const shellParts = await readParts(page, CENTRE_PARTS, 'shell');
      const shellStyles = await readCentreStyles(page, CENTRE_PARTS, 'shell');
      const drew = await page.evaluate(centreFacts);
      const mock = rows[scene];
      const expected = centreExpected(rows, scene);
      const result = compareCentre(scene, mock.parts, shellParts);
      for (const problem of result.problems) fail(`centre geometry ${where}`, problem);
      const paint = paintCentre(scene, expected.styles, shellStyles);
      for (const problem of paint.problems) fail(`centre paint ${where}`, problem);
      for (const problem of checkCentreFacts(scene, expected.facts, drew)) fail(`centre facts ${where}`, problem);
      const entry = centreEntry(`${engine} ${viewportName}`);
      entry.geometry[scene] = { worst: result.worst, problems: result.problems.length };
      entry.classes[scene] = result.classes;
      entry.textWidths[scene] = result.widths;
      entry.paint[scene] = { compared: paint.compared, absent: paint.absent, skipped: paint.skipped, problems: paint.problems.length };
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `centre-${scene}-${engine}-${viewportName}.png`) });
    } catch (error) {
      fail(`centre geometry ${where}`, `the scene did not run: ${firstLine(error)}`);
    } finally {
      if (opened !== undefined) {
        pageErrors(`centre ${where}`, opened.errors);
        await opened.context.close();
      }
    }
  }
}

/** The per-engine, per-size record of the centre's numbers (the report's `centre`). */
const centreEntry = (where) => (report.centre[where] ??= { geometry: {}, classes: {}, textWidths: {}, paint: {} });

/** One part in a page of its own: a failed step is a failure of the part, the page's errors are failures, and the context is always closed. */
async function centrePart(where, name, browser, origin, viewport, query, options, body) {
  let opened;
  try {
    opened = await scenePage(browser, origin, viewport, query, options);
    await body(opened.page);
  } catch (error) {
    fail(`centre ${name} ${where}`, `the scene did not run: ${firstLine(error)}`);
  } finally {
    if (opened !== undefined) {
      pageErrors(`centre ${name} ${where}`, opened.errors);
      await opened.context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a screen reader finds in the centre: axe on the bell closed, on the popover open (the list, an open row, the Filter menu, the empty state) and on the open list in each of the nine themes. The page around the centre is the
// shell's, whose own findings the shell's probes keep: axe is run on the bell, the dialog and the menu in it.
const centreAxe = (...selectors) => ({ include: selectors.map((selector) => [selector]) });

async function centreA11y(browser, engine, viewportName, viewport, origin, axe, only) {
  const where = `${engine} ${viewportName}`;
  const found = {};
  for (const scene of only ?? ['bell-error', 'list', 'expanded', 'menu', 'empty']) {
    await centrePart(where, `a11y ${scene}`, browser, origin, viewport, CENTRE_SCENES[scene].query, {}, async (page) => {
      await centreScene(page, scene);
      const violations = await axeOf(page, axe, centreAxe(BELL, ...(CENTRE_SCENES[scene].open === true ? [CENTRE] : [])));
      found[scene] = violations;
      for (const violation of violations) fail(`centre a11y ${where} ${scene}`, `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
    });
  }

  // The open list in each of the nine themes the host persists: the contrast of every word and mark over each theme's own roles (a control that names its scene leaves the themes out).
  if (only === undefined) {
    await centrePart(where, 'a11y themes', browser, origin, viewport, CENTRE_SCENES.list.query, {}, async (page) => {
      await centreScene(page, 'list');
      for (const theme of THEMES) {
        await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), theme);
        await sleep(200);
        const violations = await axeOf(page, axe, centreAxe(BELL, CENTRE));
        found[`theme ${theme}`] = violations;
        for (const violation of violations) fail(`centre a11y ${where} theme ${theme}`, `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
      }
    });
  }

  centreEntry(where).a11y = Object.fromEntries(Object.entries(found).map(([key, violations]) => [key, violations.length]));
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a person does with the keyboard, with real key presses, on the platform's own timers: Tab reaches the bell; Enter and Space open it and the focus is on the newest row's title (the popover itself when there is none);
// Escape closes it and the focus is back on the bell; a press outside closes it and leaves the focus on what was pressed; the list is one stop (only the current row's buttons are in the tab order), the arrows, Home and End move
// between its rows, Tab goes through the row's own buttons and leaves the list, Delete removes a row; and the Filter menu: Enter opens it, the arrows move in it, Escape closes only the menu and the focus is back on Filter.

/** Where the focus is, in the words the probe judges it by, and which buttons of the list are Tab stops (`stops`: for each row, how many of its buttons have a tabindex of 0 or more). */
function centreFocus() {
  const active = document.activeElement;
  const rows = [...document.querySelectorAll('[data-notices-part="row"]')];
  const row = active?.closest('[data-notices-part="row"]') ?? null;
  const centre = document.querySelector('[data-notices-part="centre"]');
  return {
    tag: active?.tagName ?? null,
    part: active?.getAttribute('data-notices-part') ?? null,
    label: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
    row: row === null ? -1 : rows.indexOf(row),
    inCentre: active !== null && centre !== null && centre.contains(active),
    inMenu: active?.closest('[data-notices-part="filterMenu"]') != null,
    bell: active?.matches('[data-notices-part="bell"]') ?? false,
    fixture: active?.getAttribute('data-fixture') ?? active?.getAttribute('data-probe-only') ?? null,
    stops: rows.map((each) => [...each.querySelectorAll('button')].filter((button) => button.tabIndex >= 0).length),
    rows: rows.length,
    open: centre !== null && centre.matches(':popover-open'),
    menu: document.querySelector('[data-notices-part="filterMenu"]') !== null,
  };
}

/** A text field where nothing else is, for the press outside the centre that must take the focus (WebKit does not focus a button on a click). */
function addField() {
  const field = document.createElement('input');
  field.type = 'text';
  field.setAttribute('aria-label', 'probe: a field');
  field.setAttribute('data-probe-only', 'field');
  Object.assign(field.style, { position: 'fixed', left: '20px', top: '300px', width: '120px', height: '24px', zIndex: '1' });
  document.body.append(field);
}

async function centreKeyboard(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const TAB = tabKey(engine);
  const notes = {};
  const say = (what) => fail(`centre keyboard ${where}`, what);
  await centrePart(where, 'keyboard', browser, origin, viewport, 'case=real&centre=1&seed=list', {}, async (page) => {
    const focus = () => page.evaluate(centreFocus);
    const press = async (key, wait = 120) => {
      await page.keyboard.press(key);
      await sleep(wait);
      return focus();
    };
    const says = (now) => JSON.stringify(now);

    // Tab reaches the bell, in the order of the document, from the page.
    await page.locator('[data-fixture="page-control"]').focus();
    let now = await focus();
    let presses = 0;
    while (!now.bell && presses < 60) {
      presses += 1;
      now = await press(TAB, 40);
    }

    notes.tabsToTheBell = presses;
    if (!now.bell) return say(`Tab did not reach the bell in ${presses} presses: the focus is ${says(now)}`);
    if (now.open) say(`the centre was open before it was asked for: ${says(now)}`);

    // Enter opens it, and the focus goes to the title of the newest row, which is the one stop of the list.
    await page.keyboard.press('Enter');
    await centreOpen(page).catch(() => undefined);
    await sleep(150);
    now = await focus();
    if (!now.open) return say(`Enter did not open the centre: ${says(now)}`);
    if (now.part !== 'rowToggle' || now.row !== 0) say(`the focus did not go to the newest row's title when the centre opened: ${says(now)}`);
    if (JSON.stringify(now.stops) !== JSON.stringify([2, 0, 0, 0, 0])) say(`the list is not one tab stop (the buttons in the tab order, for each row: ${JSON.stringify(now.stops)}, wanted the newest row's title and Dismiss, and no other row's)`);

    // Escape closes it, and the focus is back on the bell.
    now = await press('Escape', 200);
    if (now.open) return say(`Escape did not close the centre: ${says(now)}`);
    if (!now.bell) say(`the focus did not go back to the bell after Escape: ${says(now)}`);

    // Space opens it as Enter does.
    await page.locator(BELL).focus();
    await page.keyboard.press('Space');
    await centreOpen(page).catch(() => undefined);
    await sleep(150);
    now = await focus();
    if (!now.open) return say(`Space did not open the centre: ${says(now)}`);
    if (now.part !== 'rowToggle' || now.row !== 0) say(`the focus did not go to the newest row's title when Space opened the centre: ${says(now)}`);

    // A press outside closes it and leaves the focus on what was pressed (a field, which every engine focuses on a press).
    await page.evaluate(addField);
    await page.mouse.click(80, 312);
    await sleep(200);
    now = await focus();
    if (now.open) return say(`a press outside did not close the centre: ${says(now)}`);
    if (now.fixture !== 'field') say(`a press outside did not leave the focus on what was pressed: ${says(now)}`);

    // The list: one stop that moves with the focus; the arrows, Home and End move between rows; Tab goes through the row's own buttons and leaves the list.
    await page.locator(BELL).focus();
    await page.keyboard.press('Enter');
    await centreOpen(page).catch(() => undefined);
    await sleep(150);
    const stopsAt = (index, rows) => JSON.stringify(Array.from({ length: rows }, (_, at) => (at === index ? 2 : 0)));
    now = await press('ArrowDown');
    if (now.row !== 1 || now.part !== 'rowToggle' || JSON.stringify(now.stops) !== stopsAt(1, 5)) say(`ArrowDown did not move to the next row's title and take the list's stop with it: ${says(now)}`);
    now = await press('End');
    if (now.row !== 4 || JSON.stringify(now.stops) !== stopsAt(4, 5)) say(`End did not move to the last row: ${says(now)}`);
    now = await press('Home');
    if (now.row !== 0 || JSON.stringify(now.stops) !== stopsAt(0, 5)) say(`Home did not move to the first row: ${says(now)}`);
    now = await press(TAB);
    if (now.part !== 'rowDismiss' || now.row !== 0) say(`Tab from a row's title did not go to its Dismiss: ${says(now)}`);
    now = await press(TAB);
    if (now.row !== -1) say(`Tab from the last button of a row did not leave the list: ${says(now)}`);

    // The Filter menu: Enter opens it on its first item, the arrows, Home and End move in it, Escape closes it alone and the focus is back on Filter.
    await page.locator('[data-notices-part="filter"]').focus();
    now = await press('Enter');
    if (!now.menu || !now.inMenu || now.label !== 'All sources') return say(`Enter on Filter did not open the menu on its first item: ${says(now)}`);
    now = await press('ArrowDown');
    if (!/^P1 \(\d+\)$/.test(now.label) || !now.inMenu) say(`ArrowDown in the menu did not move to the next item: ${says(now)}`);
    now = await press('End');
    if (!/^P3 \(\d+\)$/.test(now.label)) say(`End in the menu did not move to the last item: ${says(now)}`);
    now = await press('Home');
    if (now.label !== 'All sources') say(`Home in the menu did not move to the first item: ${says(now)}`);
    now = await press('Escape');
    if (now.menu) say(`Escape did not close the Filter menu: ${says(now)}`);
    else if (!now.open) say(`Escape in the Filter menu closed the centre too: ${says(now)}`);
    else if (now.part !== 'filter') say(`Escape in the Filter menu did not give the focus back to Filter: ${says(now)}`);

    // Delete removes the row that has the focus, and the focus stays in the list.
    await page.locator('[data-notices-part="row"] [data-notices-part="rowToggle"]').first().focus();
    const before = await page.evaluate(() => window.__notices.selectors.recent().length);
    now = await press('Delete', 250);
    const after = await page.evaluate(() => window.__notices.selectors.recent().length);
    if (after !== before - 1 || now.rows !== before - 1) say(`Delete did not remove the row that had the focus (${before} records, then ${after}; ${now.rows} rows drawn)`);
    if (now.part !== 'rowToggle' || !now.inCentre) say(`the focus did not stay in the list after Delete: ${says(now)}`);
  });

  // With no record the popover itself takes the focus, so that the keyboard is inside it.
  await centrePart(where, 'keyboard empty', browser, origin, viewport, 'case=real&centre=1', {}, async (page) => {
    await page.locator(BELL).focus();
    await page.keyboard.press('Enter');
    await centreOpen(page).catch(() => undefined);
    await sleep(150);
    const now = await page.evaluate(centreFocus);
    if (!now.open) return say(`Enter did not open the empty centre: ${JSON.stringify(now)}`);
    if (now.part !== 'centre') say(`the focus did not go to the popover itself when there was no row: ${JSON.stringify(now)}`);
  });

  centreEntry(where).keyboard = notes;
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the centre costs. Production build (what a person meets), with 500 records: it opens in under two frames (the page's work from the click on the bell to the layout of the popover, at its median of nine opens), the first
// 50 rows are drawn and no more; a closed centre holds nothing (the registrations on the window and the document, the observers, the timers and frames outstanding are what they were before the first open, after it was opened, used and
// closed three times and after a notice arrived while it was closed) and nothing runs while it is closed. Development build (React's Profiler calls its callback there): a new notice while the centre is open costs one commit, the
// announcement included, and 50 notices raised in one tick cost at most one commit for each time the model told the view. Counts and a budget, and every sample is printed.
const CENTRE_OPENS = 9;
/** Two frames of a 60 Hz display, in ms. */
const TWO_FRAMES = 33.3;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * The open's clock (the page's side): from the click on the bell, in the capture phase at the window, to the end of the bubble phase at the window once the popover's box has been read, which makes the engine lay it out. A native
 * click's updates are flushed by React in a microtask after its own listener, so every commit the click made is made by then: it is the page's work from the click to the layout of the popover. `window.__opens` lists
 * `{ ms, found, rows }` for each click on the bell: how long it took, whether the popover was there with a box, and how many rows were drawn.
 */
function openClock() {
  const opens = (window.__opens = []);
  let from = null;
  window.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('[data-notices-part="bell"]') !== null) from = performance.now();
    },
    true,
  );
  window.addEventListener('click', () => {
    if (from === null) return;
    const box = document.querySelector('[data-notices-part="centre"]')?.getBoundingClientRect();
    const ms = performance.now() - from;
    from = null;
    opens.push({ ms, found: box !== undefined && box.height > 0, rows: document.querySelectorAll('[data-notices-part="row"]').length });
  });
}

/** Opens and closes the centre by its bell `CENTRE_OPENS` times, a real click each, and judges the budget. */
async function centreOpenCost(browser, engine, viewportName, viewport, production) {
  const where = `${engine} ${viewportName}`;
  const load = os.loadavg()[0];
  await centrePart(where, 'open', browser, production.origin, viewport, 'case=real&centre=1&seed=many', { init: [script(openClock)] }, async (page) => {
    await sleep(600);
    let more = null;
    for (let index = 0; index < CENTRE_OPENS; index += 1) {
      await page.click(BELL);
      await centreOpen(page);
      await sleep(150);
      more ??= await page.evaluate(() => document.querySelector('[data-notices-part="centreMore"]')?.textContent.trim() ?? null);
      await page.keyboard.press('Escape');
      await page.waitForSelector(CENTRE, { state: 'detached', timeout: WAIT });
      await sleep(150);
    }

    const opens = await page.evaluate(() => window.__opens);
    const times = opens.map((open) => round(open.ms));
    const middle = round(median(times));
    centreEntry(where).open = { samples: times, median: middle, budget: TWO_FRAMES, rows: opens.map((open) => open.rows), loadAverage: round(load) };
    console.log(`centre open ${where}: ${JSON.stringify(times)} ms, median ${middle} ms of ${TWO_FRAMES}, ${opens[0]?.rows} rows (load average ${round(load)})`);
    if (opens.length !== CENTRE_OPENS) return fail(`centre open ${where}`, `${opens.length} opens were timed, wanted ${CENTRE_OPENS}`);
    if (opens.some((open) => !open.found)) fail(`centre open ${where}`, 'the popover was not in the document, with a box, when the click\'s work was done: the clock did not see the open');
    if (opens.some((open) => open.rows !== 50)) fail(`centre open ${where}`, `the centre drew ${[...new Set(opens.map((open) => open.rows))].join(', ')} rows of 500 records, wanted the first 50 and no more`);
    if (more !== 'Show 450 older') fail(`centre open ${where}`, `the rest of the history is offered as ${JSON.stringify(more)}, wanted "Show 450 older"`);
    if (middle >= TWO_FRAMES) fail(`centre open ${where}`, `the centre took ${middle} ms at its median to open (samples ${JSON.stringify(times)}), over the two frames (${TWO_FRAMES} ms) it may take`);
  });
}

/** What a page holds and has outstanding, as the toast part counts it (palette-perf.mjs `watch`, and the observers above). */
const WATCH_KINDS = ['timeouts', 'intervals', 'frames', 'idles'];
const outstandingOf = (snapshot) => Object.fromEntries(WATCH_KINDS.map((kind) => [kind, snapshot[kind].length]));
const heldOf = (snapshot) => new Map(snapshot.held.map((entry) => [entry.key, entry]));
const takeAll = (page) => page.evaluate(() => ({ ...window.__watch.snapshot(), observers: window.__observers() }));
/** The callbacks that ran in `IDLE` ms. */
async function ranIn(page) {
  const start = await page.evaluate(() => window.__watch.now());
  const before = await page.evaluate(() => window.__watch.ran().count);
  await sleep(IDLE);
  const ran = await page.evaluate(() => window.__watch.ran());
  return { count: ran.count - before, log: ran.log.filter((entry) => entry.at >= start) };
}

const describeTimer = (entry) => `#${entry.id} ${entry.delay} ms ${entry.stack === '' ? '(no stack)' : entry.stack.slice(0, 200)}`;

/** A closed centre holds nothing: the page is read before the first open and after the centre was used and closed, and again after a notice arrived while it was closed. */
async function centreClosed(browser, engine, viewportName, viewport, production) {
  const where = `${engine} ${viewportName}`;
  const say = (what) => fail(`centre closed ${where}`, what);
  await centrePart(where, 'closed', browser, production.origin, viewport, 'case=real&centre=1&seed=list', { init: [script(watch), script(observers)], font: false }, async (page) => {
    await sleep(800);
    for (const problem of await page.evaluate(() => window.__watch.selfTest())) say(`the instrumentation is wrong: ${problem}`);
    // A source is muted before the first reading, so that a notice of it raises no toast later and its own timer (the mute ends in an hour) is part of what the page held before the first open.
    await page.evaluate(() => window.__notices.mute('p9'));
    await sleep(200);
    const quiet = await ranIn(page);
    const base = await takeAll(page);
    if (base.held.length === 0) say('the instrumentation saw no registration on the window or the document: it is not wrapping the page\'s calls');
    const compare = (label, now, ran) => {
      const [before, left] = [heldOf(base), heldOf(now)];
      const added = [...left.values()].filter((entry) => !before.has(entry.key));
      const removed = [...before.values()].filter((entry) => !left.has(entry.key));
      if (added.length > 0) say(`${added.length} registrations on the window or the document that the centre left behind (${label}): ${added.map((entry) => `${entry.key} ${entry.source}`).join('; ')}`);
      if (removed.length > 0) say(`${removed.length} registrations on the window or the document that were there before the first open and are gone (${label}): ${removed.map((entry) => `${entry.key} ${entry.source}`).join('; ')}`);
      if (now.observers.join() !== base.observers.join()) say(`observers held (${label}): ${now.observers.join(', ')}; before the first open: ${base.observers.join(', ')}`);
      const [after, was] = [outstandingOf(now), outstandingOf(base)];
      const ids = new Set(WATCH_KINDS.flatMap((kind) => base[kind].map((entry) => `${kind}:${entry.id}`)));
      for (const kind of WATCH_KINDS) {
        if (after[kind] > was[kind]) say(`${after[kind]} ${kind} outstanding (${label}), ${was[kind]} before the first open: ${now[kind].filter((entry) => !ids.has(`${kind}:${entry.id}`)).map(describeTimer).join('; ')}`);
      }

      if (ran.count !== 0) say(`${ran.count} timer or frame callbacks ran in ${IDLE} ms (${label}): ${ran.log.slice(0, 4).map(describeTimer).join('; ')}`);
    };
    if (quiet.count !== 0) say(`${quiet.count} timer or frame callbacks ran in ${IDLE} ms before the first open: ${quiet.log.slice(0, 4).map(describeTimer).join('; ')}`);

    // Opened, used (a row opened) and closed three times: nothing accumulates.
    let whileOpen = null;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.click(BELL);
      await centreOpen(page);
      await sleep(300);
      await page.click('[data-notices-part="row"] [data-notices-part="rowToggle"]');
      await sleep(100);
      whileOpen ??= await takeAll(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector(CENTRE, { state: 'detached', timeout: WAIT });
      // The pointer was over the bell and the focus is back on it: the tooltip host watches the page while a tip waits or is shown (its observer is the host's own), so neither stays where it was read.
      await page.mouse.move(1, 1);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await sleep(200);
    }

    await sleep(AFTER_CLOSE);
    const closed = await takeAll(page);
    compare('after the last close', closed, await ranIn(page));
    // The instrumentation is tried on the page: a page that holds nothing must be a page that holds nothing, not wrappers that see nothing.
    if (whileOpen.held.length <= base.held.length) say('the instrumentation saw no registration while the centre was open: it is not wrapping the page\'s calls');

    // A notice arrives while it is closed, from the source that is muted so that no toast stands (the toast layer's own listeners are its probe's); the model's own timers have run by the time it is read.
    await page.evaluate(() => {
      window.__notices.forSource('p9').notify({ title: 'Backup finished', detail: 'Nothing needs your attention.', severity: 'success', initiator: 'system' });
    });
    await sleep(1500);
    const toasts = await toastCount(page);
    if (toasts !== 0) say(`a notice of a muted source raised ${toasts} toasts: the page is not the closed centre's alone`);
    compare('after a notice arrived while it was closed', await takeAll(page), await ranIn(page));
    centreEntry(where).closed = { held: base.held.length, heldWhileOpen: whileOpen.held.length, observers: base.observers, timersBefore: outstandingOf(base), timersAfter: outstandingOf(closed), callbacksRanBefore: quiet.count };
  });
}

/** A notice that arrives while the centre is open: in the list, told once, and no toast. */
const CENTRE_NEW = () => {
  window.__notices.forSource('p9').notify({ title: 'Backup finished', detail: 'Nothing needs your attention.', severity: 'success', initiator: 'system' });
};

/** What the open page's profiler and live regions have counted so far, and how many times the model has told the view since `window.__flushes` was started. */
const centreMark = (page) => page.evaluate(() => ({ commits: window.__commits.length, announced: window.__announced.length, flushes: window.__flushes }));

/**
 * The commits of the development build, each count in a page of its own on a history three hours old (no age label changes in the second it takes): what a new notice costs the open centre, and what 50 in one tick cost. The centre is
 * opened by script and the model's listeners are counted from there.
 */
async function centreCommits(browser, engine, viewportName, viewport, development) {
  const where = `${engine} ${viewportName}`;
  const say = (what) => fail(`centre commits ${where}`, what);
  const prepare = async (page) => {
    await sleep(500);
    await page.evaluate(() => window.__centreControl.open());
    await centreOpen(page);
    await sleep(500);
    await page.evaluate(() => {
      window.__flushes = 0;
      window.__notices.subscribe(() => {
        window.__flushes += 1;
      });
    });
  };
  const counted = {};
  // One new notice: the row, the bell's name and dot, the live region's sentence and the roving tab stop are one commit.
  await centrePart(where, 'commits one', browser, development.origin, viewport, 'case=real&centre=1&seed=aged', {}, async (page) => {
    await prepare(page);
    const from = await centreMark(page);
    await page.evaluate(CENTRE_NEW);
    await sleep(700);
    const now = await centreMark(page);
    const drew = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-notices-part="row"]').length, toasts: document.querySelectorAll('[data-notices-part="toast"]').length, first: document.querySelector('[data-notices-part="rowTitle"]')?.textContent ?? null }));
    const one = { commits: now.commits - from.commits, announced: now.announced - from.announced, flushes: now.flushes - from.flushes };
    counted.one = one;
    if (drew.rows !== 6 || !/Backup finished$/.test(drew.first ?? '')) say(`the new notice is not the newest of six rows in the open centre: ${JSON.stringify(drew)}`);
    if (drew.toasts !== 0) say(`a new notice raised ${drew.toasts} toasts while the centre was open (it is in the list and told once, with no toast)`);
    if (one.announced !== 1) say(`a new notice was told ${one.announced} times through the live regions while the centre was open, wanted once`);
    if (one.commits < 1) say('a new notice made no commit the profiler saw: the development build is not reporting commits');
    else if (one.commits !== 1) say(`a new notice while the centre was open cost ${one.commits} commits, wanted one, the announcement included`);
  });
  // Fifty in one tick: at most one commit for each time the model told the view, and it tells it twice at most (the first change at once, the rest at the end of its frame).
  await centrePart(where, 'commits burst', browser, development.origin, viewport, 'case=real&centre=1&seed=aged', {}, async (page) => {
    await prepare(page);
    const from = await centreMark(page);
    await page.evaluate(() => {
      for (let index = 1; index <= 50; index += 1) window.__notices.forSource(`q${index}`).notify({ title: `Notice ${index}`, severity: 'info', initiator: 'system' });
    });
    await sleep(700);
    const now = await centreMark(page);
    const burst = { commits: now.commits - from.commits, flushes: now.flushes - from.flushes, announced: now.announced - from.announced };
    counted.burst = burst;
    if (burst.flushes > 2) say(`the model told the view ${burst.flushes} times for 50 notices raised in one tick, wanted 2 at most`);
    if (burst.commits > burst.flushes) say(`50 notices raised in one tick, with the centre open, made ${burst.commits} commits for ${burst.flushes} times the model told the view, wanted at most one for each`);
  });
  centreEntry(where).commits = counted;
}

/** The centre's parts, in pages of their own: `only.parts` narrows them (a control runs the part that must see it) and `only.scenes` narrows the scenes of the geometry. The seconds of each part are in the report. */
async function centreSection(browser, engine, viewportName, viewport, production, development, axe, only) {
  const wants = (part) => only.parts === undefined || only.parts.includes(part);
  const entry = centreEntry(`${engine} ${viewportName}`);
  const timed = async (part, run) => {
    const from = Date.now();
    await run();
    entry.seconds = { ...entry.seconds, [part]: round((Date.now() - from) / 1000) };
  };
  if (wants('geometry')) await timed('geometry', () => centreGeometry(browser, engine, viewportName, viewport, production.origin, only.scenes));
  if (wants('a11y')) await timed('a11y', () => centreA11y(browser, engine, viewportName, viewport, production.origin, axe, only.scenes));
  if (wants('keys')) await timed('keys', () => centreKeyboard(browser, engine, viewportName, viewport, production.origin));
  if (wants('open')) await timed('open', () => centreOpenCost(browser, engine, viewportName, viewport, production));
  if (wants('closed')) await timed('closed', () => centreClosed(browser, engine, viewportName, viewport, production));
  if (wants('commits') && development !== null) await timed('commits', () => centreCommits(browser, engine, viewportName, viewport, development));
}

// ---------------------------------------------------------------------------------------------------------------------------
const SECTION_NAMES = ['geometry', 'a11y', 'keyboard', 'lifetime', 'announce', 'perf', 'placement', 'centre'];
const SECTIONS = (process.env.SECTIONS ?? SECTION_NAMES.join(',')).split(',');
for (const name of SECTIONS) if (!SECTION_NAMES.includes(name)) throw new Error(`SECTIONS must be some of ${SECTION_NAMES.join(', ')}`);
const wants = (section) => (CONTROL === '' ? SECTIONS.includes(section) : PERTURBATIONS[CONTROL].sections.includes(section));
const production = await serveFixtures(buildFixtures('production'));
// React's development build is for the commit counts: the perf section's.
const development = (wants('perf') || wants('centre')) && (CONTROL === '' || PERTURBATIONS[CONTROL].parts === undefined || PERTURBATIONS[CONTROL].parts.includes('commits')) ? await serveFixtures(buildFixtures('development')) : null;
const axe = readFileSync(AXE, 'utf8');
const only = CONTROL === '' ? {} : { scenes: PERTURBATIONS[CONTROL].scenes, parts: PERTURBATIONS[CONTROL].parts };
const started = Date.now();

for (const engineName of CONTROL === '' ? engineNames : [process.env.ENGINES === undefined ? 'chromium' : engineNames[0]]) {
  const browser = await launch(engineName);
  for (const viewportName of CONTROL === '' ? viewportNames : [process.env.VIEWPORTS === undefined ? '1440x900' : viewportNames[0]]) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('geometry')) await geometry(browser, engineName, viewportName, viewport, production.origin, only.scenes);
    if (wants('a11y')) await a11y(browser, engineName, viewportName, viewport, production.origin, axe);
    if (wants('keyboard')) await keyboard(browser, engineName, viewportName, viewport, production.origin);
    if (wants('lifetime')) await lifetime(browser, engineName, viewportName, viewport, production.origin, only.parts);
    if (wants('announce')) await announce(browser, engineName, viewportName, viewport, production.origin);
    if (wants('perf')) await perf(browser, engineName, viewportName, viewport, production, development, only.parts);
    if (wants('placement')) await placement(browser, engineName, viewportName, viewport, production.origin, only.scenes);
    if (wants('centre')) await centreSection(browser, engineName, viewportName, viewport, production, development, axe, only);
    console.log(engineName, viewportName, 'done');
  }

  await browser.close();
}

production.server.close();
development?.server.close();
report.notes.push('The mock puts the dismiss control\'s -4 px margins on the control and the shell on the box that holds it (a kit button takes no margin): both are read where they are, and the control\'s own box is compared with the rest.');
report.notes.push('Layout shift: Chromium\'s layout-shift observer and the controls\' rects are both read; WebKit has no layout-shift observer, so there the controls\' rects (and the sampler\'s regions) are what is judged.');
report.notes.push('The geometry, a11y, lifetime and announce scenes read the `clock` case (the model\'s timers are the probe\'s), so that no toast closes while a loaded machine is slow to read it; the keyboard, placement and perf scenes read the platform\'s own timers with toasts that stay until the user acts.');
report.notes.push('The centre\'s scenes read the `real` case on a history the window starts with (`seed=`: restored records raise no toast and no announcement); the commits are counted on a history three hours old, so that no age label changes while they are counted. The mock\'s boxes are moved by the view control, the footer and the severity group the shell has not built, and the report counts them; the widths that follow their words are printed in `centre.<engine size>.textWidths` and not judged.');
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);

/** The centre's numbers for the console, for each engine and size (the report has every scene): the comparisons by class, the worst difference, the paint, the open's samples with the load, the commits, what a closed centre held, and the seconds of each part. */
const centreSummary = Object.fromEntries(
  Object.entries(report.centre).map(([where, entry]) => {
    const total = (kinds, keys) => Object.fromEntries(keys.map((key) => [key, Object.values(entry[kinds] ?? {}).reduce((sum, scene) => sum + (scene[key] ?? 0), 0)]));
    return [
      where,
      {
        comparisons: total('classes', ['full', 'words', 'view', 'footer', 'severity', 'absent']),
        worstDifferencePx: Math.max(0, ...Object.values(entry.geometry ?? {}).map((scene) => scene.worst)),
        paint: total('paint', ['compared', 'absent', 'skipped', 'problems']),
        open: entry.open === undefined ? undefined : { medianMs: entry.open.median, samplesMs: entry.open.samples, loadAverage: entry.open.loadAverage },
        commits: entry.commits,
        closed: entry.closed,
        keyboard: entry.keyboard,
        seconds: entry.seconds,
      },
    ];
  }),
);
console.log(
  JSON.stringify(
    {
      geometryWorst: Object.fromEntries(Object.entries(report.geometry).map(([key, value]) => [key, value.worst])),
      // What each scene's comparisons are of: boxes compared in full, and boxes whose width follows their words (a title, a button).
      geometryClasses: Object.fromEntries(Object.entries(report.geometryClasses).filter(([key]) => key.startsWith(`${engineNames[0]} ${viewportNames[0]} `)).map(([key, value]) => [key.split(' ').slice(2).join(' '), value])),
      // The two widths (the mock's, then the shell's) of what that class leaves out.
      textWidths: report.textWidths,
      perf: report.perf,
      centre: centreSummary,
      notes: report.notes,
    },
    null,
    1,
  ),
);
if (report.placement.length > 0) console.log(`\nplacement: where the stack stood\n\n${placementTable(report.placement)}\n`);
console.log(`notices probe: ${Math.round((Date.now() - started) / 1000)} s`);
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} differences, e.g. ${detected[0]}; ${failures.length - detected.length} other failures)` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${failures.length} other failures${failures.length > 0 ? `, e.g. ${failures[0]}` : ''})`);
  console.log(`its assertion, to remove with ASSERTION_OFF: ${PERTURBATIONS[CONTROL].expected.source}`);
  process.exit(detected.length > 0 ? 0 : 1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nnotices probe: no failures');
