import { describe, expect, it } from 'vitest';
import { kitGlyphOf } from './glyph';

// The host names a category's glyph as the SDK does (`LuSettings2`, internal/settings/*.go); the kit names the glyphs it took from the same set in lower-case words joined by hyphens.

describe('kitGlyphOf', () => {
  it('names the kit glyph for each glyph the host gives a category of its own', () => {
    expect(kitGlyphOf('LuSettings2')).toBe('settings-2');
    expect(kitGlyphOf('LuPaintbrush')).toBe('paintbrush');
    expect(kitGlyphOf('LuSquareTerminal')).toBe('square-terminal');
    expect(kitGlyphOf('LuCode')).toBe('code');
    expect(kitGlyphOf('LuBeaker')).toBe('beaker');
    expect(kitGlyphOf('LuActivity')).toBe('activity');
  });

  it('names nothing for a glyph the kit does not have, so the nav draws none rather than a stand-in', () => {
    expect(kitGlyphOf('LuNoSuchGlyph')).toBeUndefined();
    expect(kitGlyphOf('')).toBeUndefined();
  });

  it('reads only the SDK\'s names: a kit name, a lower-case word and a name with other characters are not glyphs of the host', () => {
    expect(kitGlyphOf('settings-2')).toBeUndefined();
    expect(kitGlyphOf('Settings2')).toBeUndefined();
    expect(kitGlyphOf('Lusettings2')).toBeUndefined();
    expect(kitGlyphOf('LuSettings2 ')).toBeUndefined();
    expect(kitGlyphOf('Lu')).toBeUndefined();
  });
});
