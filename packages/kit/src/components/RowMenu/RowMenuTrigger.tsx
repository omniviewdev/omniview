import { memo, type ReactElement } from 'react';
import commandStyles from '../../shared/command.module.css';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import type { RowMenuHandle } from './handle';
import styles from './RowMenu.module.css';

export type RowMenuTriggerProps<TRow> = {
  /** The handle of the table's one menu (`createRowMenu`). */
  readonly handle: RowMenuHandle<TRow>;
  /** The row this trigger acts for: what the menu's items are built from, and what `onSelect` receives. */
  readonly row: TRow;
  /** Its accessible name, which says whose actions these are ("Actions for web-1"). Required: a glyph names nothing. */
  readonly label: string;
} & DataAttributes;

function RowMenuTriggerImpl<TRow>({ handle, row, label, ...rest }: RowMenuTriggerProps<TRow>) {
  return (
    <button
      {...dataAttributes(rest)}
      type="button"
      className={`${commandStyles.root} ${styles.trigger}`}
      data-ov-shape="icon"
      data-ov-variant="ghost"
      data-ov-size="row"
      aria-label={label}
      aria-haspopup="menu"
      onMouseDown={(event) => {
        // A press on a trigger moves no focus. Chromium would focus the button; WebKit gives a button no focus on a press and takes it to
        // the nearest focusable ancestor instead, the table's region. Either is a focus move away from the open menu, and WebKit's closed it
        // on the press, so that the click which follows opened it again: the open trigger could not close its menu. The click is what
        // decides, and the menu that opens takes focus itself.
        event.preventDefault();
      }}
      onClick={(event) => {
        // A click with no pointer behind it is a key (Enter, Space, a screen reader's press): the first item takes focus. A pointer's
        // click focuses the menu and leaves every item to the user.
        handle.toggle(event.currentTarget, row, event.detail === 0 ? 'first' : 'menu');
      }}
      onKeyDown={(event) => {
        if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }

        // The arrow keys would scroll the table's region; here they open the menu at its first (down) or last (up) item.
        event.preventDefault();
        handle.open(event.currentTarget, row, event.key === 'ArrowUp' ? 'last' : 'first');
      }}
    >
      <Icon name="ellipsis" />
    </button>
  );
}

/**
 * The button of a row that opens its table's one menu for that row: a native button with a glyph, the row target of the density, and
 * `aria-haspopup="menu"`. It is the whole of what a row mounts for actions, and it holds nothing: no state, no effect, no context, no
 * timer, no subscription and no listener of its own (React's root delegation serves its click). `aria-expanded` and `aria-controls` are
 * not React's here: the handle writes them on the one trigger that is open. It is `memo`ised on primitive and stable props, so a row
 * that renders again with the same row object renders it no more. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export const RowMenuTrigger: <TRow>(props: RowMenuTriggerProps<TRow>) => ReactElement = memo(RowMenuTriggerImpl) as typeof RowMenuTriggerImpl;
