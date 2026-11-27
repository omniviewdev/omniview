import { describe, expect, it } from 'vitest';
import { PALETTE_ROLES, SWATCH_ROLES, normaliseColour, readAppearance, type PixelContext } from './appearance';
import { DEFAULT_PREFERENCES } from './preferences';

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

describe('the font and the cursor with the person\'s settings (#697)', () => {
  const THEME = 'font-family: \'Int UI Mono\', monospace; font-size: 12px; line-height: 18px';

  it('is the theme\'s own look until the host has said anything: the defaults of the settings are the mock\'s 12 px on an 18 px row, a block cursor', () => {
    const plain = readAppearance(paint({}, THEME));
    const withDefaults = readAppearance(paint({}, THEME), DEFAULT_PREFERENCES);
    expect(withDefaults).toEqual(plain);
    expect(plain).toMatchObject({ fontFamily: '"Int UI Mono", monospace', fontSize: 12, cursorStyle: 'block' });
    expect(plain.lineHeight).toBeCloseTo(1.5, 5);
  });

  it('puts the person\'s font names before the theme\'s face, so a name that is not installed falls to the theme\'s and never to the browser\'s serif', () => {
    expect(readAppearance(paint({}, THEME), { ...DEFAULT_PREFERENCES, fontFamily: 'JetBrains Mono, Menlo' }).fontFamily).toBe('"JetBrains Mono", "Menlo", "Int UI Mono", monospace');
    expect(readAppearance(paint({}, THEME), { ...DEFAULT_PREFERENCES, fontFamily: '' }).fontFamily).toBe('"Int UI Mono", monospace');
  });

  it('is the person\'s size, scaled by the theme\'s text scale (the swatch\'s size over the 12 px it is at 100 percent), and the person\'s line height as a multiple of it', () => {
    const chosen = { ...DEFAULT_PREFERENCES, fontSize: 16, lineHeight: 1.25 };
    const atRest = readAppearance(paint({}, THEME), chosen);
    expect(atRest.fontSize).toBe(16);
    expect(atRest.lineHeight).toBe(1.25);
    const scaled = readAppearance(paint({}, 'font-family: monospace; font-size: 15px; line-height: 20px'), chosen);
    expect(scaled.fontSize).toBe(20);
    expect(scaled.lineHeight).toBe(1.25);
  });

  it('is the person\'s cursor', () => {
    expect(readAppearance(paint({}, THEME), { ...DEFAULT_PREFERENCES, cursorStyle: 'bar' }).cursorStyle).toBe('bar');
    expect(readAppearance(paint({}, THEME), { ...DEFAULT_PREFERENCES, cursorStyle: 'underline' }).cursorStyle).toBe('underline');
  });

  it('is never a family from the person that carries more than names, even if one got here', () => {
    const hostile = readAppearance(paint({}, THEME), { ...DEFAULT_PREFERENCES, fontFamily: 'a; color: red' });
    expect(hostile.fontFamily).toBe('"Int UI Mono", monospace');
  });
});

describe('a colour that is not rgb()', () => {
  const context = (pixel: readonly number[]): PixelContext => ({
    fillStyle: '',
    clearRect: () => undefined,
    fillRect: () => undefined,
    getImageData: () => ({ data: pixel }),
  });

  it('is drawn on a pixel and read back as rgb(): the emulator reads one form, whatever the colour space the token is written in', () => {
    expect(normaliseColour('oklch(0.7 0.1 200)', context([10, 20, 30, 255]))).toBe('rgb(10, 20, 30)');
    expect(normaliseColour('color-mix(in srgb, red 50%, blue)', context([128, 0, 128, 255]))).toBe('rgb(128, 0, 128)');
  });

  it('keeps its alpha', () => {
    expect(normaliseColour('oklch(0.7 0.1 200 / 0.5)', context([10, 20, 30, 128]))).toBe('rgba(10, 20, 30, 0.502)');
  });

  it('is clean first: the pixel is cleared and black is set before the colour, so a colour the context refuses is not the one before it', () => {
    const seen: string[] = [];
    const spy: PixelContext = {
      clearRect: () => seen.push('clear'),
      fillRect: () => seen.push('fill'),
      getImageData: () => ({ data: [1, 2, 3, 255] }),
      get fillStyle(): string {
        return '';
      },
      set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        seen.push(`style:${typeof value === 'string' ? value : 'not a colour'}`);
      },
    };
    normaliseColour('oklch(0.7 0.1 200)', spy);
    expect(seen).toEqual(['clear', 'style:#000000', 'style:oklch(0.7 0.1 200)', 'fill']);
  });

  it('leaves rgb() and rgba() as they are, and an empty value (a swatch that is not there)', () => {
    expect(normaliseColour('rgb(1, 2, 3)', context([9, 9, 9, 255]))).toBe('rgb(1, 2, 3)');
    expect(normaliseColour('rgba(1, 2, 3, 0.5)', context([9, 9, 9, 255]))).toBe('rgba(1, 2, 3, 0.5)');
    expect(normaliseColour('', context([9, 9, 9, 255]))).toBe('');
  });

  it('is left as it was when there is no canvas to draw on', () => {
    expect(normaliseColour('oklch(0.7 0.1 200)', null)).toBe('oklch(0.7 0.1 200)');
  });
});
