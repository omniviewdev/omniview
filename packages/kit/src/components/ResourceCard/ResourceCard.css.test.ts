import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declarationsOf } from '../../../scripts/cssRules.ts';

// jsdom lays nothing out, so what a browser's painting depends on is asserted from the stylesheets: the boxes that draw a card's edge are never contained.
const card = await readFile(path.join(import.meta.dirname, 'ResourceCard.module.css'), 'utf8');
const grid = await readFile(path.join(import.meta.dirname, '../CardGrid/CardGrid.module.css'), 'utf8');

describe('the card and its cell', () => {
  it('contain nothing at the edge: a contained box off a whole pixel is painted up to a pixel past its edge in Chromium, and a grid flush with a scroller loses its last column\'s right edge', () => {
    for (const [sheet, selector] of [[card, '.root'], [grid, '.item']] as const) {
      const declarations = declarationsOf(sheet, selector);
      expect(declarations, selector).not.toHaveProperty('contain');
      expect(declarations, selector).not.toHaveProperty('content-visibility');
    }

    expect(declarationsOf(card, '.body')).toMatchObject({ 'content-visibility': 'auto' });
  });
});
