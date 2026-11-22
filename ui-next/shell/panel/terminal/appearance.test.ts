import { describe, expect, it } from 'vitest';
import { PALETTE_ROLES, SWATCH_ROLES, readAppearance } from './appearance';

// The look of the screen, from the theme. An emulator that draws on a canvas cannot read a stylesheet, so the body renders a hidden swatch for each colour the screen needs, painted by the stylesheet with
// the theme's own tokens, and this reads what the engine resolved for each (`getComputedStyle`): the colours follow the nine themes and the text size with no colour written in code. Here the swatches
// are painted inline; the stylesheet's side (that each swatch names the right token) is the probe's, in a real engine, in every theme.

const paint = (roles: Record<string, string>, font = 'font-family: \'Int UI Mono\', monospace; font-size: 12px; line-height: 16px'): HTMLElement => {
  const root = document.createElement('div');
  for (const role of SWATCH_ROLES) {
    const swatch = document.createElement('span');
    swatch.dataset.swatch = role;
    swatch.setAttribute('style', `color: ${roles[role] ?? 'rgb(1, 2, 3)'}`);
    root.append(swatch);
  }

  const face = document.createElement('span');
  face.dataset.swatch = 'font';
  face.setAttribute('style', font);
  root.append(face);
  return root;
};

describe('the colours of the screen', () => {
  it('are the resolved colours of the swatches, by role', () => {
    const appearance = readAppearance(paint({ background: 'rgb(25, 26, 28)', foreground: 'rgb(188, 190, 196)', cursor: 'rgb(200, 0, 0)', cursorAccent: 'rgb(0, 0, 200)', selection: 'rgb(42, 67, 113)', selectionInactive: 'rgb(60, 60, 60)' }));
    expect(appearance.theme).toMatchObject({
      background: 'rgb(25, 26, 28)',
      foreground: 'rgb(188, 190, 196)',
      cursor: 'rgb(200, 0, 0)',
      cursorAccent: 'rgb(0, 0, 200)',
      selectionBackground: 'rgb(42, 67, 113)',
      selectionInactiveBackground: 'rgb(60, 60, 60)',
    });
  });

  it('hold the sixteen of the palette, in the order the emulator numbers them (black, red, green, yellow, blue, magenta, cyan, white, then the bright ones)', () => {
    const roles = Object.fromEntries(PALETTE_ROLES.map((role, index) => [role, `rgb(${String(index)}, ${String(index)}, ${String(index)})`]));
    expect(PALETTE_ROLES).toEqual(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']);
    expect(readAppearance(paint(roles)).theme.palette).toEqual(PALETTE_ROLES.map((_, index) => `rgb(${String(index)}, ${String(index)}, ${String(index)})`));
  });

  it('are a swatch each: there is one for every role the screen needs and no other', () => {
    expect(new Set(SWATCH_ROLES).size).toBe(SWATCH_ROLES.length);
    expect(SWATCH_ROLES).toHaveLength(6 + 16);
  });
});

describe('the font of the screen', () => {
  it('is the theme\'s code font at the size the text scale makes of it, and the line height as a multiple of it', () => {
    expect(readAppearance(paint({}, 'font-family: \'Int UI Mono\', monospace; font-size: 12px; line-height: 16px'))).toMatchObject({ fontFamily: '"Int UI Mono", monospace', fontSize: 12 });
    const scaled = readAppearance(paint({}, 'font-family: \'Int UI Mono\', monospace; font-size: 15px; line-height: 20px'));
    expect(scaled.fontSize).toBe(15);
    expect(scaled.lineHeight).toBeCloseTo(20 / 15, 5);
    expect(readAppearance(paint({})).lineHeight).toBeCloseTo(16 / 12, 5);
  });

  it('falls back to a size and a line height of its own when the engine could not say (a swatch that is not laid out), and never to NaN', () => {
    const lost = readAppearance(paint({}, 'font-family: monospace; font-size: normal; line-height: normal'));
    expect(Number.isFinite(lost.fontSize)).toBe(true);
    expect(lost.fontSize).toBeGreaterThan(0);
    expect(Number.isFinite(lost.lineHeight)).toBe(true);
    expect(lost.lineHeight).toBeGreaterThan(0);
  });
});
