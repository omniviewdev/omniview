import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Tile as PluginTile } from './core/model';
import { Tile } from './Tile';

// The tile of a plugin, on its own: the glyph and the hue the model says, the two sizes, and that it is decoration. What a plugin's tile looks like is the probe's (jsdom has no layout and no paint); here is only what the
// part is given and what it says in the DOM for the stylesheet to read.

afterEach(cleanup);

const ACCENTS = ['orange', 'green', 'blue', 'purple', 'pink', 'red', 'teal'] as const;

const drawn = (tile: PluginTile, size: 24 | 28 = 24, extra: Record<`data-${string}`, string> = {}): HTMLElement => {
  const { container } = render(<Tile tile={tile} size={size} {...extra} />);
  const found = container.firstElementChild;
  if (!(found instanceof HTMLElement)) {
    throw new Error('the tile drew nothing');
  }

  return found;
};

describe('the hue', () => {
  it.each(ACCENTS)('says the accent %s the plugin names, for the stylesheet to paint', (accent) => {
    expect(drawn({ icon: 'box', accent })).toHaveAttribute('data-accent', accent);
  });

  it('says none for a plugin that names none, which is the neutral tile in the muted text colour', () => {
    expect(drawn({ icon: 'box', accent: undefined })).not.toHaveAttribute('data-accent');
  });

  it('changes with the plugin: the accent a tile was drawn with does not stay when the model says another, or none', () => {
    const { container, rerender } = render(<Tile tile={{ icon: 'box', accent: 'blue' }} size={24} />);
    expect(container.firstElementChild).toHaveAttribute('data-accent', 'blue');

    rerender(<Tile tile={{ icon: 'box', accent: 'red' }} size={24} />);
    expect(container.firstElementChild).toHaveAttribute('data-accent', 'red');

    rerender(<Tile tile={{ icon: 'box', accent: undefined }} size={24} />);
    expect(container.firstElementChild).not.toHaveAttribute('data-accent');
  });
});

describe('the box', () => {
  it.each([24, 28] as const)('is %i px: the size says so for the stylesheet, and the glyph in it is 16 px in both', (size) => {
    const tile = drawn({ icon: 'server', accent: 'blue' }, size);

    expect(tile).toHaveAttribute('data-size', String(size));
    expect(tile.querySelectorAll('svg')).toHaveLength(1);
    expect(tile.querySelector('svg')).toHaveAttribute('data-ov-size', '16');
  });

  it('draws the glyph the model names', () => {
    expect(drawn({ icon: 'server', accent: undefined }).querySelector('svg')).toHaveAttribute('data-ov-glyph', 'server');
    expect(drawn({ icon: 'layers', accent: undefined }).querySelector('svg')).toHaveAttribute('data-ov-glyph', 'layers');
  });
});

describe('decoration', () => {
  it('is hidden from assistive technology with its glyph: the name beside the tile says what the plugin is', () => {
    const tile = drawn({ icon: 'box', accent: 'teal' });

    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(tile.textContent).toBe('');
    expect(tile.querySelector('button, a, [tabindex], [role]')).toBeNull();
  });

  it('passes `data-*` on to its element, as the kit\'s parts do, and says its own over them', () => {
    const tile = drawn({ icon: 'box', accent: 'blue' }, 28, { 'data-pl-part': 'row-tile', 'data-accent': 'not this one', 'data-size': 'nor this' });

    expect(tile).toHaveAttribute('data-pl-part', 'row-tile');
    expect(tile).toHaveAttribute('data-accent', 'blue');
    expect(tile).toHaveAttribute('data-size', '28');
  });
});
