import { describe, expect, it } from 'vitest';
import { GLYPHS, isIconName, type IconName } from './glyphs';

const names = Object.keys(GLYPHS) as IconName[];

// The glyphs slice 1a draws, from the mock's first list screen (plan 1.2, tiers A and B): command glyphs, the sort arrows, the
// kind and scope glyphs, the seven status roles' glyphs, the loaders and the no-match glyph; the row menu's trigger adds the ellipsis.
// Slice 1b adds the tab strip's: the new-tab plus and the back and forward arrows. The bottom panel (P1a) adds the status bar's toggle.
// The log view (P1b2) adds its find bar's case and regex toggles and previous-match chevron, the follow glyph and the neutral debug-level circle.
// The host's Logs tool (P1b-3a) adds its own glyph, the mock's scroll of text.
// The per-kind glyphs of a plugin's resource lists (G1) add the Lucide glyphs below, named by what they draw.
const SLICE_1A = [
  'arrow-down', 'arrow-down-to-line', 'arrow-left', 'arrow-right', 'arrow-up', 'box', 'case-sensitive', 'check', 'chevron-down', 'chevron-right', 'chevron-up', 'circle',
  'circle-minus', 'clock', 'close', 'columns', 'copy', 'ellipsis', 'folder-tree', 'layers', 'loader', 'loader-circle', 'panel-bottom', 'play', 'plus', 'refresh', 'regex',
  'scroll-text', 'search', 'search-x', 'server', 'status-error', 'status-info', 'status-success', 'status-warning',
];

// G1: thirty Lucide glyphs (24 artboard, stroke 2, round caps and joins), named by what they depict.
const KIND_GLYPHS = [
  'activity', 'arrow-up-wide-narrow', 'blocks', 'brick-wall', 'calendar-clock', 'clipboard-check', 'cpu', 'database', 'file-cog', 'gauge', 'globe', 'hard-drive',
  'hard-drive-download', 'hourglass', 'key-round', 'layout-template', 'list-ordered', 'network', 'repeat', 'rocket', 'ruler', 'scaling', 'server-cog', 'settings-2',
  'shield', 'shield-check', 'split', 'target', 'umbrella', 'waypoints',
];

// P1b-4a: the Logs tool's toolbar adds the mock's pause (Int UI) and eraser (Lucide).
const LOG_TOOLBAR_GLYPHS = ['eraser', 'pause'];

// FM2a: the form parts add the number field's decrease step (Int UI), and the secret field's show and hide of the TYPED text (Int UI and Lucide).
const FORM_GLYPHS = ['eye', 'eye-off', 'minus'];

// HM1: Home, in the tab and in the palette: the mock's house (Lucide).
const HOME_GLYPHS = ['house'];

// O1b-2: the notification centre adds the mock's bell and bell-off (the status bar item), check-check (mark all read), trash (clear), undo and
// list-filter (the bar). Bell, trash and undo are Int UI in the mock (16 artboard); bell-off, check-check and list-filter are Lucide (24 artboard).
const CENTRE_LUCIDE_GLYPHS = ['bell-off', 'check-check', 'list-filter'];
const CENTRE_INT_UI_GLYPHS = ['bell', 'trash', 'undo'];

describe('the glyph registry', () => {
  it('holds the glyphs slices 1a and 1b and the per-kind lists draw, and no other', () => {
    expect([...names].sort()).toEqual([...SLICE_1A, ...KIND_GLYPHS, ...LOG_TOOLBAR_GLYPHS, ...FORM_GLYPHS, ...HOME_GLYPHS, ...CENTRE_LUCIDE_GLYPHS, ...CENTRE_INT_UI_GLYPHS].sort());
  });

  it('is plain data: nothing in it is a function, a markup string or an element', () => {
    expect(JSON.parse(JSON.stringify(GLYPHS))).toEqual(GLYPHS);
    for (const name of names) {
      expect(JSON.stringify(GLYPHS[name]), name).not.toMatch(/[<>]|<svg|<path/);
    }
  });

  it('names a glyph in lower-case words joined by hyphens, a word may end in a digit as the source names it (settings-2)', () => {
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/);
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

  it('costs one svg and one path per paint: two elements, three for the two-tone status glyphs, for the key (a filled dot) and for the bell (a clapper at its own stroke width)', () => {
    const twoTone = ['bell', 'key-round', 'status-error', 'status-info', 'status-success', 'status-warning'];
    for (const name of names) {
      const elements = 1 + GLYPHS[name].layers.length;
      expect(elements, name).toBe(twoTone.includes(name) ? 3 : 2);
    }
  });

  it('stays within its byte budget (one glyph 800 bytes, the registry 18,400: it was 7,000, then 7,200 for the bottom panel toggle, then 7,700 for the log view find bar glyphs, then 7,950 for the Logs tool glyph, then 7,060 bytes for the thirty per-kind glyphs, then 417 bytes for the Logs toolbar glyphs, then 854 bytes for the form parts\' three, then 1,774 bytes for the six notification centre glyphs, then about 250 bytes for the Home glyph; the real total is about 18,300 with 77 glyphs, and the registry is one object that is not tree-shakeable per glyph, so every glyph ships whether a screen draws it or not)', () => {
    let total = 0;
    for (const name of names) {
      const bytes = JSON.stringify(GLYPHS[name]).length;
      expect(bytes, name).toBeLessThanOrEqual(800);
      total += bytes;
    }

    expect(total).toBeLessThanOrEqual(18400);
  });

  it('draws the per-kind glyphs as the Lucide family is drawn here: 24 artboard, stroke 2, round caps and joins, one ink stroke', () => {
    for (const name of KIND_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(24);
      for (const layer of glyph.layers) {
        expect(layer.stroke, name).toBe('ink');
        expect(layer.width, name).toBe(2);
        expect(layer.cap, name).toBe('round');
        expect(layer.join, name).toBe('round');
        expect(layer.evenodd, name).toBeUndefined();
      }

      // Only a paint of its own is a second layer: the key's pin is a dot that is filled as well as stroked.
      expect(glyph.layers.filter((layer) => layer.fill !== undefined).length, name).toBe(name === 'key-round' ? 1 : 0);
    }
  });

  it('draws the notification centre glyphs from Lucide as the family is drawn here: 24 artboard, stroke 2, round caps and joins, one ink stroke, no relative moveto', () => {
    for (const name of CENTRE_LUCIDE_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(24);
      expect(glyph.layers.length, name).toBe(1);
      for (const layer of glyph.layers) {
        expect(layer.stroke, name).toBe('ink');
        expect(layer.fill, name).toBeUndefined();
        expect(layer.width, name).toBe(2);
        expect(layer.cap, name).toBe('round');
        expect(layer.join, name).toBe('round');
        expect(layer.d, name).not.toMatch(/m/);
      }
    }
  });

  it('draws the notification centre glyphs from Int UI on its 16 artboard in ink only: the bell and undo as strokes, the bin as an even-odd fill', () => {
    for (const name of CENTRE_INT_UI_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(16);
      for (const layer of glyph.layers) {
        expect(layer.stroke ?? layer.fill, name).toBe('ink');
        expect(layer.d, name).not.toMatch(/m/);
      }
    }

    expect(GLYPHS.trash.layers[0].fill).toBe('ink');
    expect(GLYPHS.trash.layers[0].evenodd).toBe(true);
    expect(GLYPHS.undo.layers[0].stroke).toBe('ink');
    expect(GLYPHS.undo.layers[0].cap).toBe('round');
    expect(GLYPHS.bell.layers.every((layer) => layer.stroke === 'ink' && layer.fill === undefined)).toBe(true);
  });

  it('merges shapes into one path without a relative moveto: a lower-case m after the start would begin at the end of the previous shape, not at the artboard origin', () => {
    for (const name of KIND_GLYPHS as IconName[]) {
      for (const layer of GLYPHS[name].layers) {
        expect(layer.d, name).not.toMatch(/m/);
      }
    }
  });

  it('guards a name from outside: true for every glyph, false for anything else', () => {
    for (const name of names) {
      expect(isIconName(name), name).toBe(true);
    }

    for (const name of ['', 'constructor', '__proto__', 'unknown-glyph']) {
      expect(isIconName(name), name).toBe(false);
    }
  });
});
