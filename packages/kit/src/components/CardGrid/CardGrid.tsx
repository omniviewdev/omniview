import { memo, useId, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './CardGrid.module.css';

/** A titled run of the grid's items: a heading, a muted line beside it, then the cards. A group with no items draws nothing. */
export type CardGridGroup<T> = {
  /** Keys the group; stable and unique among the groups. */
  readonly id: string;
  readonly title: string;
  /** One muted line after the title ("3 connections"). */
  readonly meta?: string | undefined;
  readonly items: readonly T[];
};

/**
 * What the grid draws: the items, or the items in titled groups, and the one function that draws a card from an item. The card is a pure
 * function of its item, so a card is drawn again only when its item is another object: give the grid the same item objects while nothing
 * about them changed, and a `renderCard` that is the same function from one render to the next (a module-level function, or one the React
 * Compiler keeps), and a change to one item draws one card.
 */
export type CardGridContent<T> = {
  /** The identity of an item, stable across renders and unique in its list: it keys the item's card. */
  readonly getKey: (item: T) => string;
  /** The card of an item: a `ResourceCard`. Register no menu in it: the owning view has one, and the card names its key. */
  readonly renderCard: (item: T) => ReactNode;
  /** The level of the groups' headings: 2 for a section of a page (the page's one h1 is its header's), 3 or 4 below. The look is the same. Default 2. */
  readonly level?: 2 | 3 | 4 | undefined;
} & (
  | { readonly items: readonly T[]; readonly groups?: undefined }
  | { readonly groups: ReadonlyArray<CardGridGroup<T>>; readonly items?: undefined }
);

export type CardGridProps<T> = {
  /** Names the list for assistive technology ("Connections"). */
  readonly label: string;
} & CardGridContent<T> &
  DataAttributes;

type RenderCard<T> = (item: T) => ReactNode;

const HEADINGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

function ItemImpl<T>({ item, render }: { readonly item: T; readonly render: RenderCard<T> }) {
  return (
    <li className={styles.item} data-ov-part="item">
      {render(item)}
    </li>
  );
}

/**
 * One card's cell. It renders again only when its own item or the render function changes: a patch to one item draws one card, a change of
 * the parent draws none (the same rule as a row of `DataTable`). The long collection is cheap to hold because each cell contains its own
 * layout and skips its contents while it is far off screen (see the stylesheet).
 */
const Item = memo(ItemImpl) as typeof ItemImpl;

function Group<T>({
  group,
  level,
  getKey,
  render,
}: {
  readonly group: CardGridGroup<T>;
  readonly level: 2 | 3 | 4;
  readonly getKey: (item: T) => string;
  readonly render: RenderCard<T>;
}) {
  const Heading = HEADINGS[level];
  const headingId = useId();
  if (group.items.length === 0) {
    return null;
  }

  return (
    <section className={styles.group} aria-labelledby={headingId} data-ov-part="group">
      <div className={styles.head}>
        <Heading id={headingId} className={styles.title}>
          {group.title}
        </Heading>
        {group.meta === undefined || group.meta === '' ? null : <span className={styles.meta}>{group.meta}</span>}
      </div>
      <ul className={styles.list} role="list">
        {group.items.map((item) => (
          <Item key={getKey(item)} item={item} render={render} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A responsive grid of cards (the mock's `.resource-card-grid`): as many columns as fit at 280 px at the least, 12 px apart, the columns
 * sharing the width; one column in a box narrower than that. The cards are the items of a list, so assistive technology says how many there
 * are; with `groups` each group is a labelled section with a heading of its own (the mock's `H.section`), and the sections are 20 px apart.
 * The grid has no Tab stop and no state of its own. It draws nothing for no items.
 *
 * A long collection is held in the page, not windowed: each card's cell is contained, so the browser skips the layout and the paint of the
 * ones that are far off screen. What stays is the DOM itself, about 27 elements a card (13,000 for 500 cards): window a collection of thousands
 * instead. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function CardGrid<T>({ label, getKey, renderCard, level = 2, items, groups, ...rest }: CardGridProps<T>) {
  if (groups === undefined) {
    return items.length === 0 ? null : (
      <ul {...dataAttributes(rest)} className={styles.list} role="list" aria-label={label} data-ov-part="card-grid">
        {items.map((item) => (
          <Item key={getKey(item)} item={item} render={renderCard} />
        ))}
      </ul>
    );
  }

  return (
    <div {...dataAttributes(rest)} className={styles.groups} role="group" aria-label={label} data-ov-part="card-grid">
      {groups.map((group) => (
        <Group key={group.id} group={group} level={level} getKey={getKey} render={renderCard} />
      ))}
    </div>
  );
}
