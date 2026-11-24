import { Icon, KeyHint, KindTile, isIconName, tip, type IconName } from '@omniviewdev/kit';
import { Fragment } from 'react';
import type { Label as LabelData, Row as RowData } from '../core/palette';
import styles from './Palette.module.css';

// One row of the list (ch16 S68, `H.destination`): a glyph, the name with the run that matched in weight 600, the muted context, and the trailing slot. It is one native button with the role
// option: the input holds the focus and names the active row (`aria-activedescendant`), so the row is not a Tab stop, and its accessible name is the model's (`<noun>: <title>, <context>, <state>`).
// A row is drawn from data and decides nothing: what a press does is the store's (`activate`), found by the row's id on the element.

/** A glyph the kit does not have draws its own generic one, as a tab's does. */
const FALLBACK_GLYPH: IconName = 'box';
export const glyphOf = (name: string): IconName => (isIconName(name) ? name : FALLBACK_GLYPH);

/** What the trailing slot holds, in the priority of S68. */
export type Trailing =
  | { readonly type: 'state'; readonly word: string; readonly glyph: IconName }
  | { readonly type: 'action'; readonly text: string }
  | { readonly type: 'keys'; readonly text: string }
  | { readonly type: 'drill' };

/** The glyph of a state word: what a source is doing, or what a destination can be (S65: unavailable is the neutral minus, degraded needs a look). */
function glyphOfState(row: RowData): IconName {
  if (row.kind === 'source') {
    if (row.word === 'Searching…') {
      return 'loader-circle';
    }

    if (row.word === 'Partial results') {
      return 'status-warning';
    }

    return row.word.startsWith('Showing') ? 'status-info' : 'status-error';
  }

  return row.availability.state === 'unavailable' ? 'circle-minus' : 'status-warning';
}

/** The trailing slot of a row, in priority (S68): the state word; an action word; the shortcut of a command that has one; the chevron of a row that can be searched inside. */
export function trailingOf(row: RowData): Trailing | undefined {
  const { availability } = row;
  if (availability.state === 'degraded' || (availability.state === 'unavailable' && row.kind !== 'command')) {
    return { type: 'state', word: row.word, glyph: glyphOfState(row) };
  }

  // A command that cannot run says nothing (A16): its reason is in the footer.
  if (availability.state === 'unavailable') {
    return undefined;
  }

  if (row.kind === 'more') {
    return { type: 'action', text: 'Show all' };
  }

  if (row.shortcut !== undefined) {
    return { type: 'keys', text: row.shortcut };
  }

  return row.into === undefined ? undefined : { type: 'drill' };
}

/** A label as the model cut it: the matched runs in weight 600 and the rest plain. The runs never move, so the place of a run in the text is its key. */
function Label({ label }: { readonly label: LabelData }) {
  return (
    <>
      {label.parts.map((part, index) => (
        <Fragment key={label.parts.slice(0, index).reduce((at, before) => at + before.text.length, 0)}>{part.match ? <b>{part.text}</b> : part.text}</Fragment>
      ))}
    </>
  );
}

/**
 * The accessible name of a row: the model's, with the words the row draws in its trailing slot that the model's name does not hold. A person who hears the name hears the chord of the command and the
 * word that opens a folded section, as one who reads the row sees them (WCAG 2.5.3, Label in Name). The state word is already in the model's name.
 */
function nameOf(row: RowData, trailing: Trailing | undefined): string {
  return trailing?.type === 'keys' || trailing?.type === 'action' ? `${row.name}, ${trailing.text}` : row.name;
}

type RowProps = {
  readonly row: RowData;
  /** The id of the element, which the input names as the active descendant. */
  readonly id: string;
  readonly active: boolean;
  readonly trailing: Trailing | undefined;
};

export function PaletteRow({ row, id, active, trailing }: RowProps) {
  const { availability, tile } = row;
  const reason = availability.state === 'available' ? '' : (availability.reason ?? '');
  return (
    <button
      type="button"
      role="option"
      id={id}
      className={styles.row}
      tabIndex={-1}
      aria-selected={active}
      aria-disabled={availability.state === 'unavailable' || row.inert ? true : undefined}
      aria-label={nameOf(row, trailing)}
      data-palette-part="row"
      data-palette-row={row.id}
      data-kind={row.kind}
      data-state={availability.state}
      data-inert={row.inert ? '' : undefined}
      {...tip(reason)}
    >
      {tile === undefined ? null : (
        <span className={styles.icon} data-palette-part="icon">
          {tile.tone === 'neutral' ? <Icon name={glyphOf(tile.icon)} /> : <KindTile icon={glyphOf(tile.icon)} tone={tile.tone} size={16} />}
        </span>
      )}
      <span className={styles.text} data-palette-part="text">
        <Label label={row.title} />
      </span>
      {/* The parts are spaced as words: the text a reader of the markup finds is a sentence, which is what the accessible name is compared with. A space between grid items is not drawn. */}
      {row.context.text === '' ? null : (
        <>
          {' '}
          <span className={styles.body} data-palette-part="body">
            <span className={styles.context}>
              <Label label={row.context} />
            </span>
          </span>
        </>
      )}
      {trailing === undefined ? null : (
        <>
          {' '}
          <span className={styles.meta} data-palette-part="meta" data-state-word={trailing.type === 'state' ? '' : undefined}>
            {trailing.type === 'state' ? (
              <span className={styles.mark}>
                <Icon name={trailing.glyph} />
                <span className={styles.markLabel}>{trailing.word}</span>
              </span>
            ) : null}
            {trailing.type === 'action' ? <span className={styles.action}>{trailing.text}</span> : null}
            {trailing.type === 'keys' ? <KeyHint keys={trailing.text} /> : null}
            {trailing.type === 'drill' ? (
              <span className={styles.drill} aria-hidden="true" data-palette-drill="">
                <Icon name="chevron-right" />
              </span>
            ) : null}
          </span>
        </>
      )}
    </button>
  );
}
