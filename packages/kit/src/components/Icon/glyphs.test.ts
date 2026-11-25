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

// G2: the glyphs the shell's own surfaces waited for (status/ST1.md, T1.md, PL1.md). Lucide, 24 artboard: the Plugins page's puzzle, the verbs Enable and Disable (power, power-off), Retry (rotate-cw),
// the settings Reset (rotate-ccw), a plugin with no glyph of its own (package), and the settings pages' paintbrush, code and beaker. Int UI, 16 artboard: the terminal tool's screen and the top row's gear.
const SHELL_LUCIDE_GLYPHS = ['beaker', 'code', 'package', 'paintbrush', 'power', 'power-off', 'puzzle', 'rotate-ccw', 'rotate-cw'];
const SHELL_INT_UI_GLYPHS = ['settings', 'square-terminal'];

// G3: the glyphs other steps asked for (status/T3a.md section 6, the Problems and Operations tools). Lucide, 24 artboard: the empty Problems check, the filter that clears, the find bar's whole-word switch and the
// terminal menu's Select all (the mock has no select-all glyph; its text-select is the nearest). Int UI, 16 artboard, one even-odd ink fill each: the warning triangle, the external link and the paste.
const ASKED_LUCIDE_GLYPHS = ['circle-check', 'filter-x', 'select-all', 'whole-word'];
const ASKED_INT_UI_GLYPHS = ['external-link', 'paste', 'triangle-alert'];

// The landing page's glyphs: the plugin tile, scopes, view modes, the connection menu, folder presets and the reorder handle. Lucide, 24 artboard, one ink stroke of 2 each; Int UI, 16 artboard, with the paints of its artwork.
// `history` draws the artwork of `clock` (the mock maps both to Int UI's history icon) under the name of what it means.
const LANDING_LUCIDE_GLYPHS = [
  'archive', 'bookmark', 'boxes', 'flask-conical', 'grip-vertical', 'layout-grid', 'layout-list', 'log-in', 'panel-right-open', 'plug', 'ship', 'sliders-horizontal', 'unplug', 'wrench',
];
const LANDING_INT_UI_GLYPHS = ['folder', 'folder-plus', 'history', 'pencil', 'pin', 'table'];

describe('the glyph registry', () => {
  it('holds the glyphs slices 1a and 1b and the per-kind lists draw, and no other', () => {
    expect([...names].sort()).toEqual(
      [...SLICE_1A, ...KIND_GLYPHS, ...LOG_TOOLBAR_GLYPHS, ...FORM_GLYPHS, ...HOME_GLYPHS, ...CENTRE_LUCIDE_GLYPHS, ...CENTRE_INT_UI_GLYPHS, ...SHELL_LUCIDE_GLYPHS, ...SHELL_INT_UI_GLYPHS, ...ASKED_LUCIDE_GLYPHS, ...ASKED_INT_UI_GLYPHS, ...LANDING_LUCIDE_GLYPHS, ...LANDING_INT_UI_GLYPHS].sort(),
    );
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

  it('costs one svg and one path per paint: two elements, three for the two-tone status glyphs, for the key (a filled dot), for the bell (a clapper at its own stroke width), for the terminal screen (a filled frame and a prompt at its own stroke width) and for the table (a filled frame and its rules), four for the new-folder glyph (a plus, a body and an outline)', () => {
    const twoTone = ['bell', 'key-round', 'square-terminal', 'status-error', 'status-info', 'status-success', 'status-warning', 'table'];
    for (const name of names) {
      const elements = 1 + GLYPHS[name].layers.length;
      expect(elements, name).toBe(name === 'folder-plus' ? 4 : twoTone.includes(name) ? 3 : 2);
    }
  });

  it('stays within its byte budget (one glyph 800 bytes but the gear, which is 1,735 as the mock draws it and may be 1,800; the registry 30,666: 7,000 for slice 1a, 18,400 after G1 and the steps that followed it, 22,450 after the eleven glyphs of G2, then 2,288 bytes for the seven of G3, then 5,925 for the 20 of the landing page; the real total is 30,555 with 115 glyphs, and the registry is one object that is not tree-shakeable per glyph, so every glyph ships whether a screen draws it or not: status/G2.md measures it)', () => {
    let total = 0;
    for (const name of names) {
      const bytes = JSON.stringify(GLYPHS[name]).length;
      expect(bytes, name).toBeLessThanOrEqual(name === 'settings' ? 1800 : 800);
      total += bytes;
    }

    expect(total).toBeLessThanOrEqual(30666);
  });

  it('draws the landing glyphs as their families are drawn here: Lucide on 24 in one ink stroke of 2 with no relative moveto, Int UI on 16, each a name of the registry', () => {
    for (const name of LANDING_LUCIDE_GLYPHS as IconName[]) {
      expect(isIconName(name), name).toBe(true);
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(24);
      expect(glyph.layers.length, name).toBe(1);
      expect(glyph.layers[0], name).toMatchObject({ stroke: 'ink', width: 2, cap: 'round', join: 'round' });
      expect(glyph.layers[0].fill, name).toBeUndefined();
      expect(glyph.layers[0].d, name).not.toMatch(/m/);
    }

    for (const name of LANDING_INT_UI_GLYPHS as IconName[]) {
      expect(isIconName(name), name).toBe(true);
      expect(GLYPHS[name].box, name).toBe(16);
    }
  });

  it('draws the shell glyphs from Lucide as the family is drawn here: 24 artboard, stroke 2, round caps and joins, one ink stroke, no relative moveto', () => {
    for (const name of SHELL_LUCIDE_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(24);
      expect(glyph.layers.length, name).toBe(1);
      for (const layer of glyph.layers) {
        expect(layer.stroke, name).toBe('ink');
        expect(layer.fill, name).toBeUndefined();
        expect(layer.width, name).toBe(2);
        expect(layer.cap, name).toBe('round');
        expect(layer.join, name).toBe('round');
        expect(layer.evenodd, name).toBeUndefined();
        expect(layer.d, name).not.toMatch(/m/);
      }
    }
  });

  it('draws the glyphs of G3 as their families are drawn here: Lucide on 24 in one ink stroke of 2 with no relative moveto, Int UI on 16 as one even-odd ink fill', () => {
    for (const name of ASKED_LUCIDE_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(24);
      expect(glyph.layers.length, name).toBe(1);
      expect(glyph.layers[0], name).toMatchObject({ stroke: 'ink', width: 2, cap: 'round', join: 'round' });
      expect(glyph.layers[0].fill, name).toBeUndefined();
      expect(glyph.layers[0].d, name).not.toMatch(/m/);
    }

    for (const name of ASKED_INT_UI_GLYPHS as IconName[]) {
      const glyph = GLYPHS[name];
      expect(glyph.box, name).toBe(16);
      expect(glyph.layers.length, name).toBe(1);
      expect(glyph.layers[0], name).toMatchObject({ fill: 'ink', evenodd: true });
      expect(glyph.layers[0].stroke, name).toBeUndefined();
      expect(glyph.layers[0].d, name).not.toMatch(/m/);
    }
  });

  it('draws the terminal screen as Int UI draws it: a framed screen on a literal fill of the artwork, and a prompt at a 1.2 stroke, on the 16 artboard', () => {
    const screen = GLYPHS['square-terminal'];
    expect(screen.box).toBe(16);
    expect(screen.layers.length).toBe(2);
    expect(screen.layers[0]).toMatchObject({ fill: '#43454A', stroke: 'ink' });
    expect(screen.layers[0].width).toBeUndefined();
    const prompt = screen.layers.at(1);
    expect(prompt).toMatchObject({ stroke: 'ink', width: 1.2 });
    expect(prompt?.fill).toBeUndefined();
  });

  it('draws the gear as Int UI draws it: one even-odd ink fill on the 16 artboard, in relative coordinates after its first moveto (the mock holds 2,616 bytes of absolute path data), and every moveto after the first is absolute', () => {
    const gear = GLYPHS.settings;
    expect(gear.box).toBe(16);
    expect(gear.layers.length).toBe(1);
    expect(gear.layers[0]).toMatchObject({ fill: 'ink', evenodd: true });
    expect(gear.layers[0].stroke).toBeUndefined();
    expect(gear.layers[0].d).toMatch(/^M/);
    expect(gear.layers[0].d).not.toMatch(/m/);
    expect(gear.layers[0].d.match(/M/g)?.length).toBe(4);
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
