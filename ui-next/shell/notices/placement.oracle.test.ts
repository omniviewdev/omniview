import { describe, expect, it } from 'vitest';
import { decide, HOME, type Control, type Place } from './placement';

// The oracle: the mock's own algorithm (aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock/shell-notify.js, `meets`, `clearOf`, `slide` and `place`, lines 1259-1311), copied with the page reads and the
// writes taken out: what `place()` reads (the controls and whether each answers at its centre, the home box, the stack's height, the window's width, where the stack stands) is given, and what it would have set is
// returned. The rule is the lead's ruling for this step, and the mock's code is the rule's exact form: the port must give the answer the mock gives on every page, which is what is checked, on pages of every
// size and 10,000 layouts of controls from a fixed seed.

type R = { left: number; top: number; right: number; bottom: number };
type C = { r: R; seen: boolean };
type Placed = { mode: 'default' | 'moved' | 'yield'; x: number; y: number; w: number };
type Mock = { mode: 'default' | 'moved' | 'yield' | 'kept'; x: number; y: number; w: number };

const PLACE = { pad: 4, gap: 8, top: 8, edge: 12 };
const WIDTHS = [420, 360, 320, 280, 240];

const meets = (r: R, b: R, pad: number) => r.left < b.right + pad && r.right > b.left - pad && r.top < b.bottom + pad && r.bottom > b.top - pad;
const clearOf = (list: C[], b: R) => !list.some((c) => meets(c.r, b, PLACE.pad) && c.seen);

function slide(list: C[], left: number, w: number, h: number, limit: number): number | null {
  const b = { left, right: left + w };
  const spans = list
    .filter((c) => c.r.left < b.right + PLACE.gap && c.r.right > b.left - PLACE.gap && c.seen)
    .map((c) => [c.r.top - PLACE.gap, c.r.bottom + PLACE.gap])
    .sort((a, z) => a[0] - z[0]);
  let best: number | null = null;
  let cursor = PLACE.top;
  for (const [from, to] of spans) {
    const end = Math.min(from, limit);
    if (end - cursor >= h) {
      best = end;
    }

    cursor = Math.max(cursor, to);
  }

  if (limit - cursor >= h) {
    best = limit;
  }

  return best == null ? null : best - h;
}

function mockPlace(input: { list: C[]; fb: R; hostH: number; n: number; vw: number; placed: Placed }): Mock {
  const { list, fb, hostH, n, vw, placed } = input;
  const baseW = Math.round(fb.right - fb.left);
  const lines = (w: number) => (w < baseW ? Math.ceil((baseW - w) / 120) : 0);
  const curW = placed.mode === 'moved' ? placed.w : baseW;
  const natural = hostH - 16 * n * lines(curW);
  const heightAt = (w: number) => natural + 16 * n * lines(w);
  const limit = Math.round(fb.bottom);
  const homeX = (w: number) => Math.round(fb.right) - w;
  const box = (x: number, y: number, w: number, h: number): R => ({ left: x, top: y, right: x + w, bottom: y + h });
  if (clearOf(list, box(homeX(baseW), limit - natural, baseW, natural))) {
    return { mode: 'default', x: 0, y: 0, w: baseW };
  }

  if (placed.mode === 'moved' && clearOf(list, box(placed.x, placed.y, placed.w, hostH))) {
    return { mode: 'kept', x: placed.x, y: placed.y, w: placed.w };
  }

  for (const w of [baseW, ...WIDTHS.filter((x) => x < baseW)]) {
    const h = heightAt(w);
    const xs = new Set([homeX(w), Math.round((vw - w) / 2), PLACE.edge]);
    for (const c of list) {
      if (c.seen) {
        xs.add(Math.round(c.r.right + PLACE.gap));
        xs.add(Math.round(c.r.left - PLACE.gap - w));
      }
    }

    const near = [...xs].filter((x) => x >= PLACE.edge && x + w <= vw - PLACE.edge).sort((a, z) => Math.abs(a - homeX(w)) - Math.abs(z - homeX(w))).slice(0, 80);
    let best: { x: number; y: number; cost: number } | null = null;
    for (const x of near) {
      const y = slide(list, x, w, h, limit);
      if (y == null) {
        continue;
      }

      const cost = Math.abs(x - homeX(w)) + Math.abs(y - (limit - h));
      if (!best || cost < best.cost) {
        best = { x, y, cost };
      }
    }

    if (best) {
      return { mode: 'moved', x: best.x, y: best.y, w };
    }
  }

  return { mode: 'yield', x: 0, y: 0, w: baseW };
}

/** A small deterministic generator (mulberry32), so the layouts are the same on every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the port gives the answer the mock gives', () => {
  it('on 10,000 layouts of controls, on windows of every size, from every place the stack can be in', () => {
    const next = generator(20261120);
    const between = (low: number, high: number) => Math.round(low + next() * (high - low));
    const sizes: ReadonlyArray<readonly [number, number]> = [[1440, 900], [1280, 800], [1000, 700], [800, 600], [600, 500], [400, 700], [324, 600]];
    const tally = { default: 0, kept: 0, moved: 0, yield: 0 };
    for (let index = 0; index < 10_000; index += 1) {
      const [vw, vh] = sizes[between(0, sizes.length - 1)];
      const baseW = Math.min(420, vw - 24);
      const fb: R = { left: vw - 12 - baseW, top: vh - 44 - 120, right: vw - 12, bottom: vh - 44 };
      const count = between(1, 3);
      const hostH = count * between(40, 90) + (count - 1) * 8;
      const list: C[] = [];
      for (let made = between(0, 40); made > 0; made -= 1) {
        // A third of the controls are in the corner the stack calls home, to make a conflict likely.
        const nearHome = next() < 0.34;
        const left = nearHome ? between(vw - 460, vw - 40) : between(-20, vw);
        const top = nearHome ? between(vh - 330, vh - 40) : between(-20, vh);
        list.push({ r: { left, top, right: left + between(6, 400), bottom: top + between(6, 200) }, seen: next() < 0.9 });
      }

      const kind = next();
      const placed: Placed =
        kind < 0.4
          ? { mode: 'default', x: 0, y: 0, w: baseW }
          : kind < 0.55
            ? { mode: 'yield', x: 0, y: 0, w: baseW }
            : { mode: 'moved', x: between(12, Math.max(12, vw - 252)), y: between(8, vh - 200), w: WIDTHS.filter((w) => w <= baseW)[between(0, 2)] ?? baseW };
      const expected = mockPlace({ list, fb, hostH, n: count, vw, placed });
      const controls: Control[] = list.map((c) => ({ box: c.r, reached: () => c.seen }));
      const current: Place = placed.mode === 'default' ? HOME : placed.mode === 'yield' ? { mode: 'yield' } : { mode: 'moved', x: placed.x, y: placed.y, w: placed.w };
      const got = decide({ controls, viewport: vw, home: { right: fb.right, bottom: fb.bottom, width: baseW }, count, height: hostH, current });
      tally[expected.mode] += 1;
      if (expected.mode === 'kept') {
        expect(got, `layout ${String(index)}`).toBe(current);
      } else if (expected.mode === 'default') {
        expect(got, `layout ${String(index)}`).toBe(HOME);
      } else if (expected.mode === 'yield') {
        expect(got, `layout ${String(index)}`).toEqual({ mode: 'yield' });
      } else {
        expect(got, `layout ${String(index)}`).toEqual({ mode: 'moved', x: expected.x, y: expected.y, w: expected.w });
      }
    }

    // The sample has every outcome in it, or it proves nothing about the ones it lacks.
    expect(tally.default).toBeGreaterThan(50);
    expect(tally.kept).toBeGreaterThan(20);
    expect(tally.moved).toBeGreaterThan(200);
    expect(tally.yield).toBeGreaterThan(20);
  });
});
