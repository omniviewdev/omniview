import { describe, expect, it } from 'vitest';
import { GLYPHS, type IconName } from './glyphs';

const names = Object.keys(GLYPHS) as IconName[];

// The glyphs slice 1a draws, from the mock's first list screen (plan 1.2, tiers A and B): command glyphs, the sort arrows, the
// kind and scope glyphs, the seven status roles' glyphs, the loaders and the no-match glyph.
const SLICE_1A = [
  'arrow-down', 'arrow-up', 'box', 'check', 'chevron-down', 'chevron-right', 'circle-minus', 'clock', 'close', 'columns', 'copy',
  'folder-tree', 'layers', 'loader', 'loader-circle', 'play', 'refresh', 'search', 'search-x', 'server', 'status-error', 'status-info',
  'status-success', 'status-warning',
];

describe('the glyph registry', () => {
  it('holds the glyphs slice 1a draws, and no other', () => {
    expect([...names].sort()).toEqual(SLICE_1A);
  });

  it('is plain data: nothing in it is a function, a markup string or an element', () => {
    expect(JSON.parse(JSON.stringify(GLYPHS))).toEqual(GLYPHS);
    for (const name of names) {
      expect(JSON.stringify(GLYPHS[name]), name).not.toMatch(/[<>]|<svg|<path/);
    }
  });

  it('names a glyph in lower-case words joined by hyphens', () => {
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it('draws every glyph on a 16 or 24 artboard, in layers of path data', () => {
    for (const name of names) {
      const glyph = GLYPHS[name];
      expect([16, 24], name).toContain(glyph.box);
      expect(glyph.layers.length, name).toBeGreaterThan(0);
      for (const layer of glyph.layers) {
        expect(layer.d, name).toMatch(/^M[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]*$/);
      }
    }
  });

  it('rounds coordinates to three decimals', () => {
    for (const name of names) {
      for (const layer of GLYPHS[name].layers) {
        expect(layer.d, name).not.toMatch(/\d\.\d{4,}/);
      }
    }
  });

  it('paints every layer, and gives stroke settings to stroked layers only', () => {
    for (const name of names) {
      for (const layer of GLYPHS[name].layers) {
        expect(layer.fill !== undefined || layer.stroke !== undefined, name).toBe(true);
        if (layer.stroke === undefined) {
          expect(layer.width, name).toBeUndefined();
          expect(layer.cap, name).toBeUndefined();
          expect(layer.join, name).toBeUndefined();
        }
      }
    }
  });

  it('paints in ink, a role of the stylesheet, or a literal colour of the artwork', () => {
    const roles = ['ink', 'chevron', 'success', 'error', 'info', 'warning', 'warning-mark'];
    for (const name of names) {
      for (const layer of GLYPHS[name].layers) {
        for (const paint of [layer.fill, layer.stroke]) {
          if (paint !== undefined) {
            expect(roles.includes(paint) || /^#[0-9A-F]{6}$/.test(paint), `${name}: ${paint}`).toBe(true);
          }
        }
      }
    }
  });

  it('costs one svg and one path per paint: two elements, three for the two-tone status glyphs', () => {
    const twoTone = ['status-error', 'status-info', 'status-success', 'status-warning'];
    for (const name of names) {
      const elements = 1 + GLYPHS[name].layers.length;
      expect(elements, name).toBe(twoTone.includes(name) ? 3 : 2);
    }
  });

  it('stays within its byte budget (one glyph 800 bytes, the registry 7,000)', () => {
    let total = 0;
    for (const name of names) {
      const bytes = JSON.stringify(GLYPHS[name]).length;
      expect(bytes, name).toBeLessThanOrEqual(800);
      total += bytes;
    }

    expect(total).toBeLessThanOrEqual(7000);
  });
});
