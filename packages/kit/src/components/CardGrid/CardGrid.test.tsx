import { render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { ResourceCard } from '../ResourceCard';
import { CardGrid, type CardGridGroup } from './CardGrid';
import * as examples from './CardGrid.examples';

type Item = { readonly id: string; readonly name: string };

const item = (id: string): Item => ({ id, name: `Connection ${id.toUpperCase()}` });
const A = item('a');
const B = item('b');
const C = item('c');

const getKey = (value: Item) => value.id;
const renderCard = (value: Item) => <ResourceCard title={value.name} actions={<Button size="row">Open</Button>} />;

type Extra = { readonly renderCard?: (value: Item) => ReactNode; readonly level?: 2 | 3 | 4; readonly 'data-testid'?: string };

const flat = (items: readonly Item[], extra: Extra = {}) => (
  <CardGrid<Item> label="Connections" items={items} getKey={getKey} renderCard={extra.renderCard ?? renderCard} data-testid={extra['data-testid']} />
);

const grouped = (groups: ReadonlyArray<CardGridGroup<Item>>, extra: Extra = {}) => (
  <CardGrid<Item> label="Connections" groups={groups} getKey={getKey} renderCard={extra.renderCard ?? renderCard} level={extra.level} data-testid={extra['data-testid']} />
);

const group = (id: string, items: readonly Item[], meta?: string): CardGridGroup<Item> => ({ id, title: id, meta, items });

describe('CardGrid', () => {
  it('is a list named by its label with one list item for each item, in order, and a card in each', () => {
    render(flat([A, B, C]));
    const list = screen.getByRole('list', { name: 'Connections' });
    const cells = within(list).getAllByRole('listitem');
    expect(cells.map((cell) => cell.textContent)).toEqual(['Connection AOpen', 'Connection BOpen', 'Connection COpen']);
    // The grid is not a control and not a region: no landmark, no heading of its own, and no Tab stop other than the cards' own.
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(list.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('is a labelled section with a heading for each group, the muted line beside it, and nothing for a group with no items', () => {
    const { container, rerender } = render(grouped([group('production', [A, B], '2 connections'), group('empty', []), group('testing', [C])], { 'data-testid': 'cards' }));
    const wrapper = screen.getByRole('group', { name: 'Connections' });
    expect(wrapper).toBe(screen.getByTestId('cards'));
    expect(container.firstElementChild).toBe(wrapper);

    const sections = screen.getAllByRole('region');
    const [production, testing] = sections as [HTMLElement, HTMLElement];
    // The page's one h1 is its header's, so a group is a section of the page: a level 2 heading, and the caller says when it sits lower.
    expect(sections.map((section) => within(section).getByRole('heading', { level: 2 }).textContent)).toEqual(['production', 'testing']);
    expect(sections.map((section) => section.getAttribute('aria-labelledby'))).toEqual(sections.map((section) => within(section).getByRole('heading').id));
    expect(within(production).getByText('2 connections')).toBeTruthy();
    expect(within(production).getAllByRole('listitem')).toHaveLength(2);
    expect(within(testing).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'empty' })).toBeNull();

    rerender(grouped([group('production', [A])], { level: 3 }));
    expect(screen.getByRole('heading', { level: 3, name: 'production' })).toBeTruthy();
  });

  it('draws a card again only when its item is another object: one render for each item, and a patch to one draws one', () => {
    const draw = vi.fn(renderCard);
    const { rerender } = render(flat([A, B, C], { renderCard: draw }));
    expect(draw).toHaveBeenCalledTimes(3);

    // The parent draws again with the same items and the same function: no card is drawn.
    rerender(flat([A, B, C], { renderCard: draw }));
    expect(draw).toHaveBeenCalledTimes(3);

    // One item is patched and the order changes: the patched card is drawn, the others are moved and keep their elements.
    const cells = screen.getAllByRole('listitem');
    const patched = { ...B, name: 'Connection B2' };
    rerender(flat([C, patched, A], { renderCard: draw }));
    expect(draw).toHaveBeenCalledTimes(4);
    expect(draw).toHaveBeenLastCalledWith(patched);
    expect(screen.getAllByRole('listitem').map((cell) => cell.textContent)).toEqual(['Connection COpen', 'Connection B2Open', 'Connection AOpen']);
    expect(screen.getAllByRole('listitem')[0]).toBe(cells[2]);
    expect(screen.getAllByRole('listitem')[2]).toBe(cells[0]);
  });

  it('draws nothing for no items and for groups that have none, and passes data attributes to its list', () => {
    const { container, rerender } = render(flat([]));
    expect(container.firstElementChild).toBeNull();
    rerender(grouped([group('empty', [])]));
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    rerender(flat([A], { 'data-testid': 'cards' }));
    expect(screen.getByTestId('cards')).toBe(screen.getByRole('list', { name: 'Connections' }));
  });

  it('has examples that all draw a list or groups, and the long one holds 500 cards in five groups', () => {
    const entries = Object.entries(examples) as Array<[string, ComponentType]>;
    expect(entries.length).toBeGreaterThanOrEqual(7);
    for (const [name, Example] of entries) {
      const { container, unmount } = render(<Example />);
      expect(container.querySelector('[data-ov-part="card-grid"]'), name).not.toBeNull();
      expect(container.querySelector('[title], [style]'), name).toBeNull();
      if (name === 'FiveHundredCards') {
        expect(screen.getAllByRole('region')).toHaveLength(5);
        expect(screen.getAllByRole('listitem')).toHaveLength(500);
      }

      unmount();
    }
  });
});
