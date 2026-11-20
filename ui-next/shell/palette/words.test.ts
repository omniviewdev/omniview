import { describe, expect, it } from 'vitest';
import type { Chip } from '../core/palette';
import { chordGlyphs, chordName, chordText, domId, inputLabel, noteText } from './words';

// The words and the ids of the palette: how a chord is written for the platform it is pressed on, what the input is called, what an empty list says. One place, so no component builds its own.

describe('the chord of a key hint (S70)', () => {
  it('writes the keys of the open row the way the mock does on a Mac: one glyph for each key, Command before Shift', () => {
    expect(chordGlyphs('Enter', 'mac')).toBe('↵');
    expect(chordGlyphs('Alt+Enter', 'mac')).toBe('⌥↵');
    expect(chordGlyphs('Mod+Shift+Enter', 'mac')).toBe('⌘⇧↵');
    expect(chordGlyphs('Mod+Enter', 'mac')).toBe('⌘↵');
    expect(chordGlyphs('Shift+Enter', 'mac')).toBe('⇧↵');
    expect(chordGlyphs('ArrowRight', 'mac')).toBe('→');
    expect(chordGlyphs('Escape', 'mac')).toBe('Esc');
  });

  it('writes them as words joined by plus elsewhere, with Control for Mod', () => {
    expect(chordGlyphs('Enter', 'other')).toBe('Enter');
    expect(chordGlyphs('Alt+Enter', 'other')).toBe('Alt+Enter');
    expect(chordGlyphs('Mod+Shift+Enter', 'other')).toBe('Ctrl+Shift+Enter');
    expect(chordGlyphs('Mod+Enter', 'other')).toBe('Ctrl+Enter');
    expect(chordGlyphs('ArrowRight', 'other')).toBe('→');
    expect(chordGlyphs('Escape', 'other')).toBe('Esc');
  });

  it('names a chord for a screen reader in words, never in glyphs', () => {
    expect(chordName('Mod+Shift+Enter', 'mac')).toBe('Command Shift Enter');
    expect(chordName('Alt+Enter', 'mac')).toBe('Option Enter');
    expect(chordName('Mod+Enter', 'other')).toBe('Control Enter');
    expect(chordName('ArrowRight', 'other')).toBe('Right Arrow');
    expect(chordName('Escape', 'mac')).toBe('Escape');
  });

  it('writes the chord of the Search control: Command K on a Mac, Control K elsewhere', () => {
    expect(chordText('Mod+K', 'mac')).toBe('⌘K');
    expect(chordText('Mod+K', 'other')).toBe('Ctrl+K');
  });
});

describe('what the input is called', () => {
  const chip = (kind: Chip['kind'], label: string): Chip => ({ kind, id: label, label, plugin: 'acme', noun: kind === 'plugin' ? 'plugin' : 'scope', icon: '' });

  it('says Search, and where it searches when it is narrowed (S69)', () => {
    expect(inputLabel([])).toBe('Search');
    expect(inputLabel([chip('plugin', 'Acme'), chip('scope', 'north')])).toBe('Search in Acme › north');
  });
});

describe('what an empty list says', () => {
  it('quotes the query that matched nothing, as the mock does', () => {
    expect(noteText({ type: 'no-results', query: 'zzz' })).toBe('No results for “zzz”');
    expect(noteText({ type: 'nothing' })).toBe('Nothing to show yet');
    expect(noteText(undefined)).toBe('');
  });
});

describe('the ids of the rows', () => {
  it('makes an id the DOM and aria-activedescendant can hold, and never the same one for two rows', () => {
    const ids = ['goto|host:pages|page:acme:items', 'goto|host:pages|page:acme:items ', 'a b', 'a_b', 'a-b', '😀', '😁'].map((id) => domId('p', id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_:-]+$/u);
    }
  });
});
