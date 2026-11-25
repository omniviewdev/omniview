import { describe, expect, it } from 'vitest';
import type { EngineTheme } from './engine';
import { contrast, findDecorations, hexOf, mix, parseColour } from './findColours';

// The colours of a find in the terminal (T3a). The search addon draws its highlights with decorations whose backgrounds must be `#RRGGBB` (it says so, and the emulator's own colour code reads no other form), and the host's theme
// gives the colours it resolved as `rgb()`, `rgba()` or a hex. The highlights are derived from the theme: the palette's yellow mixed into the screen's background, as much as the screen's text can be read over (WCAG 4.5 to 1).

const PALETTE = ['#000000', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'];

const theme = (patch: Partial<EngineTheme> = {}): EngineTheme => ({
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionInactiveBackground: '#3a3d41',
  palette: PALETTE,
  ...patch,
});

const HEX = /^#[0-9a-f]{6}$/;

describe('parsing a colour the theme resolved', () => {
  it.each([
    ['#1e1e1e', [30, 30, 30]],
    ['#FFF', [255, 255, 255]],
    ['#e5c07b', [229, 192, 123]],
    ['#e5c07bcc', [229, 192, 123]],
    ['rgb(30, 30, 46)', [30, 30, 46]],
    ['rgba(30, 30, 46, 0.5)', [30, 30, 46]],
    ['rgb(30 30 46)', [30, 30, 46]],
    ['rgb(30 30 46 / 50%)', [30, 30, 46]],
  ] as const)('reads %s', (value, rgb) => {
    expect(parseColour(value)).toEqual(rgb);
  });

  it.each(['', 'red', 'oklch(0.5 0.1 200)', '#12', '#12345', 'rgb(300, 0, 0)', 'rgb(a, b, c)', 'transparent'])('reads nothing from %j: it is not a colour the emulator was given', (value) => {
    expect(parseColour(value)).toBeUndefined();
  });
});

describe('a colour as the search addon wants it', () => {
  it('is `#rrggbb`: lower case, two digits for each channel, rounded', () => {
    expect(hexOf([0, 0, 0])).toBe('#000000');
    expect(hexOf([255, 255, 255])).toBe('#ffffff');
    expect(hexOf([229, 192, 123])).toBe('#e5c07b');
    expect(hexOf([1.4, 2.6, 15.5])).toBe('#010310');
  });

  it('mixes one colour into another by an amount, channel by channel', () => {
    expect(mix([0, 0, 0], [200, 100, 50], 0)).toEqual([0, 0, 0]);
    expect(mix([0, 0, 0], [200, 100, 50], 1)).toEqual([200, 100, 50]);
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });

  it('measures contrast as WCAG does: 21 to 1 for black on white, 1 to 1 for a colour on itself', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 5);
  });
});

describe('the decorations of a find', () => {
  it('are all `#RRGGBB`, the one form the addon takes: the backgrounds, the border of the current match and the overview ruler, and a match has no border of its own while its fill marks it', () => {
    const decorations = findDecorations(theme());
    for (const value of Object.values(decorations)) {
      expect(value).toMatch(HEX);
    }

    expect(Object.keys(decorations).sort()).toEqual(['activeMatchBackground', 'activeMatchBorder', 'activeMatchColorOverviewRuler', 'matchBackground', 'matchOverviewRuler']);
  });

  it('are derived from the theme, as the mock draws a find: a dim amber for the matches (the palette\'s yellow, at most a fifth of the way from the background to it), the colour of the selection for the current one, and the text\'s colour as its border', () => {
    const decorations = findDecorations(theme());
    const background = parseColour('#1e1e1e');
    const yellow = parseColour('#e5c07b');
    const match = parseColour(decorations.matchBackground);
    if (background === undefined || yellow === undefined || match === undefined) {
      throw new Error('a decoration is not a colour');
    }

    expect(decorations.matchBackground).not.toBe('#1e1e1e');
    // Each channel of a match lies between the background and the yellow, and no further from the background than a fifth of the way to the yellow (the colour is rounded to a whole channel).
    for (const channel of [0, 1, 2] as const) {
      expect(match[channel]).toBeGreaterThanOrEqual(Math.min(background[channel], yellow[channel]));
      expect(match[channel]).toBeLessThanOrEqual(Math.max(background[channel], yellow[channel]));
      expect(Math.abs(match[channel] - background[channel])).toBeLessThanOrEqual(0.2 * Math.abs(yellow[channel] - background[channel]) + 0.5);
    }

    expect(decorations.activeMatchBackground).toBe('#264f78');
    expect(decorations.matchOverviewRuler).toBe('#e5c07b');
    expect(decorations.activeMatchColorOverviewRuler).toBe('#61afef');
    expect(decorations.activeMatchBorder).toBe('#d4d4d4');
  });

  it.each([
    ['a dark theme', theme()],
    ['a light theme', theme({ background: '#ffffff', foreground: '#1f2328', palette: PALETTE.map((_, index) => (index === 3 || index === 11 ? '#9a6700' : '#444444')) })],
    ['a high contrast theme', theme({ background: '#000000', foreground: '#ffffff', palette: PALETTE.map((_, index) => (index === 3 || index === 11 ? '#ffff00' : '#cccccc')) })],
  ] as const)('keep the text of the screen readable over them, in %s: 4.5 to 1, the current match too', (_name, given) => {
    const decorations = findDecorations(given);
    const text = parseColour(given.foreground);
    const match = parseColour(decorations.matchBackground);
    const active = parseColour(decorations.activeMatchBackground);
    if (text === undefined || match === undefined || active === undefined) {
      throw new Error('a colour does not parse');
    }

    expect(contrast(text, match)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, active)).toBeGreaterThanOrEqual(4.5);
  });

  it('do not draw the current match in a selection colour the text cannot be read on: a pale selection under pale text gives a mix of the palette\'s blue that it can', () => {
    const decorations = findDecorations(theme({ selectionBackground: '#ffffff' }));
    const text = parseColour('#d4d4d4');
    const active = parseColour(decorations.activeMatchBackground);
    if (text === undefined || active === undefined) {
      throw new Error('a colour does not parse');
    }

    expect(decorations.activeMatchBackground).not.toBe('#ffffff');
    expect(contrast(text, active)).toBeGreaterThanOrEqual(4.5);
  });

  it('check the contrast of the colour the addon is given, which is rounded: white text on black with a pale blue gives the mix of 45 in 100, not the half, whose `#777777` is 4.478 to 1 though its unrounded channels, 118.5, are 4.51', () => {
    // The selection is not a colour the emulator reads, so the current match is a mix of the blue.
    const decorations = findDecorations(theme({ background: '#000000', foreground: '#ffffff', selectionBackground: '', palette: PALETTE.map((_, index) => (index === 4 ? '#ededed' : '#888888')) }));
    const active = parseColour(decorations.activeMatchBackground);
    if (active === undefined) {
      throw new Error('a decoration is not a colour');
    }

    expect(decorations.activeMatchBackground).toBe('#6b6b6b');
    expect(contrast([255, 255, 255], active)).toBeGreaterThanOrEqual(4.5);
  });

  it('keep the background for a match when no mix of the yellow keeps the text readable, and give the match a border to be told by: white on `#767676` is 4.54 to 1, and any yellow added to it is less', () => {
    const decorations = findDecorations(theme({ background: '#767676', foreground: '#ffffff', palette: PALETTE.map((_, index) => (index === 3 ? '#ffff00' : '#444444')) }));
    const text = parseColour('#ffffff');
    const match = parseColour(decorations.matchBackground);
    if (text === undefined || match === undefined) {
      throw new Error('a decoration is not a colour');
    }

    expect(decorations.matchBackground).toBe('#767676');
    expect(contrast(text, match)).toBeGreaterThanOrEqual(4.5);
    expect(decorations.matchBorder).toMatch(HEX);
    expect(decorations.matchBorder).not.toBe('#767676');
  });

  it('keep a mix of the yellow, and no border, when the text stays readable over it', () => {
    const decorations = findDecorations(theme({ background: '#767676', foreground: '#ffffff', palette: PALETTE.map((_, index) => (index === 3 ? '#000000' : '#444444')) }));
    expect(decorations.matchBackground).not.toBe('#767676');
    expect(decorations).not.toHaveProperty('matchBorder');
  });

  it('read the colours the way the host resolves them: rgb() and rgba() as well as hex', () => {
    const resolved = findDecorations(theme({ background: 'rgb(30, 30, 30)', foreground: 'rgb(212, 212, 212)', palette: PALETTE.map((colour) => {
      const channels = parseColour(colour);
      return channels === undefined ? colour : `rgb(${channels.join(', ')})`;
    }) }));
    expect(resolved).toEqual(findDecorations(theme()));
  });

  it('are still `#RRGGBB` for a theme whose colours are not ones the emulator can read: they fall back to a yellow over a dark background, so a find never draws a colour the addon refuses', () => {
    const decorations = findDecorations(theme({ background: 'oklch(0.2 0 0)', foreground: 'currentcolor', selectionBackground: 'oklch(0.4 0.1 250)', palette: [] }));
    for (const value of Object.values(decorations)) {
      expect(value).toMatch(HEX);
    }
  });
});
