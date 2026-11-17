// The layout-shift measurement of the page probe: a frame sampler (requestAnimationFrame: the rectangles of the named parts at every frame, compared with the
// first frame) around an operation in the page header's slot. The parts must not move by even 0.001 px: a single moved pixel is a defect.

/** The smallest move that counts, in px. Layout is in 1/64 px, so any real move is far above it. */
export const EPS = 0.001;

/**
 * Page side (self-contained). Starts the sampler on `specs` ({ name, sel, nth?, ignore? }; `ignore` lists the keys of x, y, w, h a part may change
 * by design). The first frame is the baseline. `window.__sampler.phase(name)` names what is going on, `.stop()` ends it and returns what was seen.
 */
export function installSampler({ specs, eps }) {
  const region = document.querySelector('[data-shell-part="page"]') ?? document;
  const read = () =>
    specs.map((spec) => {
      const element = region.querySelectorAll(spec.sel)[spec.nth ?? 0];
      if (element === undefined) return null;
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height];
    });
  const base = read();
  const state = { frames: 0, phase: 'start', phases: {}, moves: {}, shiftValue: 0, shifts: 0, stopped: false };
  // Only what happens from here on: a buffered observer would also count the load and the setup of the case, which are not the operation's.
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.shiftValue += entry.value;
        state.shifts += 1;
      }
    });
    observer.observe({ type: 'layout-shift' });
  } catch {
    state.shiftValue = null;
  }

  const tick = () => {
    if (state.stopped) return;
    state.frames += 1;
    state.phases[state.phase] = (state.phases[state.phase] ?? 0) + 1;
    const now = read();
    specs.forEach((spec, index) => {
      const was = base[index];
      const is = now[index];
      if (was === null || is === null) {
        if ((was === null) !== (is === null)) {
          const key = `${spec.name}.present`;
          state.moves[key] = state.moves[key] ?? { max: 1, frames: 0, phase: state.phase, frame: state.frames };
          state.moves[key].frames += 1;
        }
        return;
      }

      for (let k = 0; k < 4; k += 1) {
        const letter = 'xywh'[k];
        if ((spec.ignore ?? '').includes(letter)) continue;
        const d = Math.abs(is[k] - was[k]);
        if (d <= eps) continue;
        const key = `${spec.name}.${letter}`;
        const move = state.moves[key] ?? { max: 0, frames: 0, phase: state.phase, frame: state.frames };
        move.max = Math.max(move.max, d);
        move.frames += 1;
        state.moves[key] = move;
      }
    });
    requestAnimationFrame(tick);
  };

  window.__sampler = {
    phase: (name) => {
      state.phase = name;
    },
    stop: () => {
      state.stopped = true;
      for (const entry of observer?.takeRecords() ?? []) {
        state.shiftValue += entry.value;
        state.shifts += 1;
      }

      return state;
    },
  };
  requestAnimationFrame(tick);
}

/** Two frames after a change: the page has laid out and painted what the change made. */
export const frames = (page, count = 2) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const next = () => {
          left -= 1;
          if (left <= 0) resolve(undefined);
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    count,
  );

/** The parts of a list page that must not move while its header's slot is used (the title may change its width: it shares its row with the slot). */
export const LIST_PARTS = [
  { name: 'dataView', sel: '[data-ov-state]' },
  { name: 'dvHeader', sel: '[data-ov-part="header"]' },
  { name: 'dvBody', sel: '[data-ov-part="body"]' },
  { name: 'pageHeader', sel: 'header' },
  { name: 'headerRow', sel: '[data-ov-row]' },
  { name: 'title', sel: 'h1', ignore: 'w' },
  { name: 'commands', sel: '[role="group"][aria-label$=" commands"]' },
  { name: 'refresh', sel: '[role="group"][aria-label$=" commands"] button' },
  { name: 'quick', sel: '[data-ov-block="filters"] > [role="group"]' },
  { name: 'chipAll', sel: '[data-ov-block="filters"] button', nth: 0 },
  { name: 'chipCompleted', sel: '[data-ov-block="filters"] button', nth: 4 },
  { name: 'toolbar', sel: '[data-ov-block="toolbar"] > [role="group"]' },
  { name: 'search', sel: 'input[type="search"]' },
  { name: 'thead', sel: 'thead' },
  { name: 'firstRow', sel: 'tbody tr[data-ov-index]' },
  { name: 'footer', sel: '[data-ov-part="footer"]' },
  { name: 'count', sel: '[data-ov-part="footer"] [data-ov-cluster="lead"]' },
];

/** The parts of a header on its own, and the block under it. The facts and the reason give way to an operation by design (they are not here). */
export const HEADER_PARTS = [
  { name: 'header', sel: 'header' },
  { name: 'row', sel: '[data-ov-row]' },
  { name: 'title', sel: 'h1', ignore: 'w' },
  { name: 'meta', sel: '[data-ov-meta]' },
  { name: 'state', sel: '[data-ov-state-chip]' },
  { name: 'commands', sel: '[role="group"][aria-label$=" commands"]' },
  { name: 'next', sel: '[data-fixture="next"]' },
];

const LONG = 'Waiting for the API server to confirm that every replica of orders-api in the checkout deployment is ready to receive traffic in the staging environment';
const TITLE = 'Scale orders-api';
const running = { title: TITLE, state: 'running', text: 'Adding 3 replicas', progress: 0.33, actions: ['cancel'] };

/**
 * One operation going through its states, in the realistic texts of the mock's slot and longer ones: queued, running (determinate and indeterminate, a
 * label longer than its room), paused, succeeded (one line, two lines), failed (two lines, longer than two, with and without Retry and Dismiss),
 * cancelled, unknown, retried, dismissed. `null` is the slot at rest.
 */
export const OPERATIONS = [
  ['queued', { title: TITLE, state: 'queued', text: 'Queued · waiting for a free worker', progress: 'indeterminate', actions: ['cancel'] }],
  ['running determinate', running],
  ['running with no Cancel', { ...running, actions: [] }],
  ['running indeterminate', { ...running, text: 'Waiting for the API server', progress: 'indeterminate' }],
  ['running label too long', { ...running, text: LONG, progress: 0.6 }],
  ['paused', { title: TITLE, state: 'paused', text: 'Paused · Waiting for approval', progress: 0.5, actions: ['cancel'] }],
  ['succeeded', { title: TITLE, state: 'succeeded', text: 'Scaled orders-api to 3 replicas', dismiss: true }],
  ['succeeded two lines', { title: TITLE, state: 'succeeded', text: 'Scaled orders-api to 3 replicas in checkout and waited for every replica to report ready in the staging environment', dismiss: true }],
  ['succeeded with no Dismiss', { title: TITLE, state: 'succeeded', text: 'Scaled orders-api to 3 replicas' }],
  ['failed two lines', { title: TITLE, state: 'failed', text: "Couldn't scale orders-api. The API server refused: the checkout quota allows 2 replicas.", actions: ['retry'], dismiss: true }],
  ['failed longer than two lines', { title: TITLE, state: 'failed', text: `${LONG}. ${LONG}.`, actions: ['retry'], dismiss: true }],
  ['failed with no Retry', { title: TITLE, state: 'failed', text: "Couldn't scale orders-api. The API server refused.", dismiss: true }],
  ['failed with neither', { title: TITLE, state: 'failed', text: "Couldn't scale orders-api." }],
  ['cancelled', { title: TITLE, state: 'cancelled', text: 'Canceled · Stopped before every replica was ready', actions: ['retry'], dismiss: true }],
  ['unknown', { title: TITLE, state: 'unknown', text: 'The connection dropped before the API server answered; the scale may or may not have happened', dismiss: true }],
  ['retried', { title: TITLE, state: 'running', text: 'Attempt 2 · Adding 3 replicas', progress: 0, actions: ['cancel'] }],
  ['dismissed', null],
];
