import { describe, expect, it } from 'vitest';
import { placeMenu } from './placement';

const size = { width: 200, height: 120 };
const viewport = { width: 800, height: 600 };

describe('menu placement', () => {
  it('flips an anchored menu and clamps the inline edge', () => {
    expect(placeMenu({ kind: 'trigger', align: 'end', rect: { left: 774, right: 798, top: 560, bottom: 584 } }, size, viewport, false))
      .toEqual({ side: 'top', left: 596, top: 436, maxWidth: 792, maxHeight: undefined });
  });

  it('places a too-tall menu on the roomier side and caps its height', () => {
    expect(placeMenu({ kind: 'trigger', align: 'end', rect: { left: 200, right: 224, top: 80, bottom: 104 } }, size, { width: 800, height: 200 }, true))
      .toEqual({ side: 'bottom', left: 200, top: 108, maxWidth: 792, maxHeight: 88 });
  });

  it('opens pointer context menus toward logical end when space permits', () => {
    expect(placeMenu({ kind: 'point', x: 500, y: 120 }, size, viewport, true))
      .toEqual({ side: 'bottom', left: 300, top: 120, maxWidth: 792, maxHeight: undefined });
  });

  it('places a keyboard context menu inside an anchor that fills the viewport', () => {
    expect(placeMenu({ kind: 'trigger', align: 'start', rect: { left: 40, right: 760, top: 0, bottom: 600 } }, size, viewport, false))
      .toEqual({ side: 'bottom', left: 40, top: 300, maxWidth: 792, maxHeight: undefined });
  });

  it('flips a branch and keeps long submenu content in the viewport', () => {
    expect(placeMenu({ kind: 'branch', panel: { left: 620, right: 796, top: 260, bottom: 380 }, rowTop: 300, lead: 9, side: 'right' }, { width: 180, height: 1000 }, viewport, false))
      .toEqual({ side: 'left', left: 442, top: 4, maxWidth: 792, maxHeight: 592 });
  });
});
