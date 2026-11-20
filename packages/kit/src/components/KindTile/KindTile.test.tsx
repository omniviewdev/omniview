import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { KindTile, type KindTileProps, type KindTileTone } from './KindTile';
import * as examples from './KindTile.examples';

const TONES: readonly KindTileTone[] = ['neutral', 'orange', 'green', 'blue', 'purple', 'pink', 'red', 'teal'];

describe('KindTile', () => {
  it('is a decorative tile: a span hidden from assistive technology that holds one glyph', () => {
    const { container } = render(<KindTile icon="box" />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.tagName).toBe('SPAN');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.textContent).toBe('');
    for (const attribute of ['role', 'aria-label', 'title', 'tabindex', 'style']) {
      expect(tile.hasAttribute(attribute), attribute).toBe(false);
    }

    const glyph = tile.querySelector('svg');
    expect(glyph?.getAttribute('data-ov-glyph')).toBe('box');
    expect(glyph?.getAttribute('data-ov-size')).toBe('16');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is neutral and 20 px unless it is told otherwise', () => {
    const { container } = render(<KindTile icon="server" />);
    expect(container.firstElementChild).toHaveProperty('dataset.ovTone', 'neutral');
    expect(container.firstElementChild).toHaveProperty('dataset.ovSize', '20');
  });

  it('draws the glyph of its kind: any glyph of the registry, whatever the tile or the tone', () => {
    for (const icon of ['box', 'server', 'folder-tree', 'layers'] as const) {
      const { container, unmount } = render(<KindTile icon={icon} tone="blue" />);
      expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe(icon);
      unmount();
    }
  });

  it('turns its tone and its size into data attributes for its stylesheet', () => {
    for (const tone of TONES) {
      const { container, unmount } = render(<KindTile icon="box" tone={tone} size={16} />);
      expect(container.firstElementChild).toHaveProperty('dataset.ovTone', tone);
      expect(container.firstElementChild).toHaveProperty('dataset.ovSize', '16');
      unmount();
    }
  });

  it('keeps the glyph at 16 px in a 16 px tile as in a 20 px one: the tile gives the box, never the glyph its size', () => {
    for (const size of [16, 20] as const) {
      const { container, unmount } = render(<KindTile icon="box" size={size} />);
      expect(container.querySelector('svg')?.getAttribute('data-ov-size')).toBe('16');
      unmount();
    }
  });

  it('has the elements it says: the tile, the glyph and one path per paint: three', () => {
    const { container } = render(<KindTile icon="box" />);
    expect(container.querySelectorAll('*')).toHaveLength(3);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(1);
  });

  it('knows no kind: the mapping from a kind to a glyph and a tone is the caller\'s data', () => {
    // a tile takes a glyph name, never a kind: nothing here can resolve one
    const accepted: KindTileProps[] = [{ icon: 'box' }, { icon: 'layers', tone: 'teal', size: 20 }, { icon: 'server', tone: undefined, size: undefined }];
    // @ts-expect-error a tile has a glyph
    const iconless: KindTileProps = {};
    // @ts-expect-error a glyph outside the registry
    const unknownIcon: KindTileProps = { icon: 'sparkles' };
    // @ts-expect-error a tone outside the closed set: any CSS colour is not one
    const unknownTone: KindTileProps = { icon: 'box', tone: 'chartreuse' };
    // @ts-expect-error a size outside the closed set
    const unknownSize: KindTileProps = { icon: 'box', size: 24 };
    // @ts-expect-error a kind is not a prop: the caller maps its kinds to glyphs
    const withKind: KindTileProps = { icon: 'box', kind: 'Server' };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: KindTileProps = { icon: 'box', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: KindTileProps = { icon: 'box', style: { color: 'red' } };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: KindTileProps = { icon: 'box', title: 'hint' };
    expect([accepted, iconless, unknownIcon, unknownTone, unknownSize, withKind, withClass, withStyle, withTitle]).toHaveLength(9);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = KindTile as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { icon: 'box', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', role: 'img', 'aria-label': 'Item' };
    const { getByTestId } = render(<Loose {...loose} />);
    const tile = getByTestId('probe');
    expect(tile.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'role', 'aria-label']) {
      expect(tile.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(tile.getAttribute('aria-hidden')).toBe('true');
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<KindTile icon="box" tone="blue" />);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The stylesheet, as the rules it holds (jsdom lays nothing out; a browser's layout is probed in packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'KindTile.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the KindTile stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is a square that centres its glyph, keeps its size and takes the control radius, with no edge and no fill of its own', () => {
    expect(rule('.root')).toMatchObject({
      display: 'inline-flex',
      'flex-shrink': '0',
      'align-items': 'center',
      'justify-content': 'center',
      'box-sizing': 'border-box',
      border: '0',
      'border-radius': 'var(--ov-radius-control)',
      color: 'var(--_tone)',
    });
    expect(Object.keys(rule('.root'))).not.toContain('background-color');
    expect(Object.keys(rule('.root'))).not.toContain('background');
  });

  it('is 20 px or 16 px square', () => {
    expect(rule('.root[data-ov-size=\'20\']')).toEqual({ width: '20px', height: '20px' });
    expect(rule('.root[data-ov-size=\'16\']')).toEqual({ width: '16px', height: '16px' });
  });

  it('colours the glyph by tone: the icon role for neutral, a brand hue of the design for the others', () => {
    expect(rule('.root')['--_tone']).toBe('var(--ov-icon)');
    for (const tone of TONES.filter((entry) => entry !== 'neutral')) {
      expect(rule(`.root[data-ov-tone='${tone}']`), tone).toEqual({ '--_tone': `var(--ov-brand-${tone})` });
    }
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a KindTile is shown in.
type Row = { readonly glyphs: readonly string[]; readonly tones: readonly string[]; readonly sizes: readonly string[] };
const MATRIX: Readonly<Record<string, Row>> = {
  Neutral: { glyphs: ['box'], tones: ['neutral'], sizes: ['20'] },
  Blue: { glyphs: ['box'], tones: ['blue'], sizes: ['20'] },
  Small: { glyphs: ['box'], tones: ['blue'], sizes: ['16'] },
  AllTones: { glyphs: Array.from({ length: 8 }, () => 'box'), tones: [...TONES], sizes: Array.from({ length: 8 }, () => '20') },
  DistinctKinds: { glyphs: ['box', 'server', 'folder-tree', 'layers'], tones: ['blue', 'blue', 'blue', 'blue'], sizes: ['20', '20', '20', '20'] },
};

describe('KindTile examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.glyphs.length} decorative tile${row.glyphs.length === 1 ? '' : 's'}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const tiles = [...container.querySelectorAll<HTMLElement>('[data-ov-tone]')];
      expect(tiles.map((tile) => tile.querySelector('svg')?.getAttribute('data-ov-glyph'))).toEqual([...row.glyphs]);
      expect(tiles.map((tile) => tile.getAttribute('data-ov-tone'))).toEqual([...row.tones]);
      expect(tiles.map((tile) => tile.getAttribute('data-ov-size'))).toEqual([...row.sizes]);
      // a tile is decoration: hidden from assistive technology, never a control, never named by a title
      for (const tile of tiles) {
        expect(tile.getAttribute('aria-hidden')).toBe('true');
      }

      expect(container.textContent).toBe('');
      expect(container.querySelectorAll('button, a, [tabindex], [role]')).toHaveLength(0);
      expect(container.querySelector('[title]')).toBeNull();
    });
  }

  it('shows different kinds with different glyphs, so two tiles of different kinds never look alike (13 GL1)', () => {
    const { container } = render(<examples.DistinctKinds />);
    const glyphs = [...container.querySelectorAll('svg')].map((svg) => svg.getAttribute('data-ov-glyph'));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
