import { describe, expect, it } from 'vitest';
import { cycle, escapeTarget } from './regions';

// Regions in reading order, the ones that have something to focus: the top row, the sidebar, the page, the status bar (ch16 S12).
const stops = ['topRow', 'sidebar', 'island', 'statusBar'];

describe('cycle (F6 and Shift+F6)', () => {
  it('moves to the next region with F6 and to the previous with Shift+F6', () => {
    expect(cycle(stops, 'sidebar', 1)).toBe('island');
    expect(cycle(stops, 'sidebar', -1)).toBe('topRow');
  });

  it('wraps past the last region and past the first', () => {
    expect(cycle(stops, 'statusBar', 1)).toBe('topRow');
    expect(cycle(stops, 'topRow', -1)).toBe('statusBar');
  });

  it('enters the first region going forward and the last going back, from focus that sits in none of them', () => {
    expect(cycle(stops, undefined, 1)).toBe('topRow');
    expect(cycle(stops, undefined, -1)).toBe('statusBar');
    expect(cycle(stops, 'stale', 1)).toBe('topRow');
  });

  it('stays on the only region there is, and has nowhere to go when there is none', () => {
    expect(cycle(['island'], 'island', 1)).toBe('island');
    expect(cycle(['island'], undefined, -1)).toBe('island');
    expect(cycle([], 'island', 1)).toBeUndefined();
  });

  it('visits every region once in a full turn, each way', () => {
    const forward: string[] = [];
    let at: string | undefined;
    for (let step = 0; step < stops.length; step += 1) {
      at = cycle(stops, at, 1);
      forward.push(String(at));
    }

    expect(forward).toEqual(stops);

    const back: string[] = [];
    at = undefined;
    for (let step = 0; step < stops.length; step += 1) {
      at = cycle(stops, at, -1);
      back.push(String(at));
    }

    expect(back).toEqual([...stops].reverse());
  });
});

describe('escapeTarget (Escape from a region)', () => {
  it('returns the focus to the page from any other region', () => {
    expect(escapeTarget('sidebar', 'island')).toBe('island');
    expect(escapeTarget('topRow', 'island')).toBe('island');
    expect(escapeTarget('statusBar', 'island')).toBe('island');
  });

  it('leaves Escape alone in the page, where it belongs to the page, and outside the shell', () => {
    expect(escapeTarget('island', 'island')).toBeUndefined();
    expect(escapeTarget(undefined, 'island')).toBeUndefined();
  });
});
