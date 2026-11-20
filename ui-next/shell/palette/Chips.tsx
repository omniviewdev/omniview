import { Icon, tip } from '@omniviewdev/kit';
import type { KeyboardEvent } from 'react';
import type { Chip } from '../core/palette';
import styles from './Palette.module.css';
import { glyphOf } from './Row';

// The chips of a narrowed search (ch16 S69): the plugin, then the places under it (a scope, a type, a resource). A chip is a glyph, a label that is a button (pressed while it is the one
// selected) and a named Remove. Both buttons are out of the Tab order: the keyboard reaches them with the arrows from the input (the model's `key`), and one Tab stop for the whole row is
// the input. Kit part it should become: a chip that is pressed and removable, with a glyph (the kit's `Chip` is one mode at a time and has no glyph).

/** What a chip is called to a screen reader: its label, and for a place under the plugin what kind of place it is (`scope north`). */
export const chipName = (chip: Chip): string => (chip.kind === 'plugin' ? chip.label : `${chip.noun === '' ? chip.kind : chip.noun.toLowerCase()} ${chip.label}`);

type ChipsProps = {
  readonly chips: readonly Chip[];
  /** The chip that is selected (`←` from the input), or `-1`. */
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onRemove: (index: number) => void;
  /** A key pressed on one of a chip's buttons. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
};

export function Chips({ chips, selected, onSelect, onRemove, onKeyDown }: ChipsProps) {
  return (
    <div className={styles.chips} role="group" aria-label="Search scope" data-palette-part="chips">
      {chips.map((chip, index) => {
        const name = chipName(chip);
        // Removing a chip removes the ones under it (S69), and its name says so unless it is the last.
        const remove = index < chips.length - 1 ? `Remove ${name} and dependent scopes` : `Remove ${name}`;
        return (
          <span key={`${chip.kind}:${chip.id}`} className={styles.chip} data-palette-part="chip">
            {chip.icon === '' ? null : (
              <span className={styles.chipGlyph} aria-hidden="true">
                <Icon name={glyphOf(chip.icon)} />
              </span>
            )}
            <button
              type="button"
              tabIndex={-1}
              className={styles.chipLabel}
              aria-label={name}
              aria-pressed={selected === index}
              data-palette-chip-label={index}
              {...tip(name)}
              onClick={() => {
                onSelect(index);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              {chip.label}
            </button>
            <button
              type="button"
              tabIndex={-1}
              className={styles.chipRemove}
              aria-label={remove}
              data-palette-chip-remove={index}
              {...tip(remove)}
              onClick={() => {
                onRemove(index);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
