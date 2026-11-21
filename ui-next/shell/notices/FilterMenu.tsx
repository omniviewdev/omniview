import { Icon, type IconName } from '@omniviewdev/kit';
import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import type { Below } from './centreDom';
import { showPopover } from './centreDom';
import type { SourceChoice } from './centreList';
import styles from './Centre.module.css';

// The Filter menu of the notification centre (ch16 S80; the mock's `filterItems`, shell-feedback.js, the shared menu mounted inside the popover): the Source group, one radio item for each source that has a record and one for all
// of them; then, once a source is chosen, Mute that source for an hour (or Unmute it) and Clear filters. It is the one way the centre has to mute a source, as the mock's is. The severity group of the mock's menu is not built:
// the step is the mute, and the mute needs the source. It is a nested popover of the centre's, so a press in it is a press in the centre and never closes it.

/** The width of the menu, in px. */
export const MENU_WIDTH = 240;

export type FilterMenuProps = {
  readonly id: string;
  readonly place: Below;
  /** The sources to choose from, All sources first. */
  readonly choices: readonly SourceChoice[];
  /** The chosen source; empty is all of them. */
  readonly source: string;
  /** The chosen source's name, for the words of its items. */
  readonly name: string;
  /** The chosen source is muted now. */
  readonly muted: boolean;
  readonly onChoose: (source: string) => void;
  /** Mute the chosen source for an hour, or unmute it. */
  readonly onMute: () => void;
  readonly onClear: () => void;
  /** The menu closes, with the focus given back to the button that opened it, or leaving it where the person put it. */
  readonly onClose: (restore: boolean) => void;
};

/** The items a key can reach, in order: not the titles, which are for the eye. */
const ITEMS = '[role="menuitemradio"], [role="menuitem"]';

function move(menu: HTMLElement, key: string): boolean {
  const items = [...menu.querySelectorAll<HTMLElement>(ITEMS)];
  const at = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  const to = key === 'Home' ? 0 : key === 'End' ? last : key === 'ArrowDown' ? (at < 0 ? 0 : (at + 1) % items.length) : at < 0 ? last : (at - 1 + items.length) % items.length;
  items[to]?.focus({ preventScroll: true });
  return items.length > 0;
}

type ItemProps = {
  readonly role: 'menuitemradio' | 'menuitem';
  readonly checked?: boolean | undefined;
  readonly icon?: IconName | undefined;
  readonly onSelect: () => void;
  readonly children: string;
};

function Item({ role, checked, icon, onSelect, children }: ItemProps) {
  return (
    <button type="button" role={role} aria-checked={role === 'menuitemradio' ? checked === true : undefined} tabIndex={-1} className={styles.menuItem} data-notices-part="filterItem" onClick={onSelect}>
      <span className={styles.menuMark} aria-hidden="true">
        {role === 'menuitemradio' ? (checked === true ? <Icon name="check" /> : null) : icon === undefined ? null : <Icon name={icon} />}
      </span>
      <span className={styles.menuLabel}>{children}</span>
    </button>
  );
}

export function FilterMenu({ id, place, choices, source, name, muted, onChoose, onMute, onClear, onClose }: FilterMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  // Mounting is opening: the menu goes to the top layer and the focus goes to the chosen source, which is where a person looks first.
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) {
      return;
    }

    showPopover(element);
    const checked = element.querySelector<HTMLElement>('[aria-checked="true"]') ?? element.querySelector<HTMLElement>(ITEMS);
    checked?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === 'Escape') {
      // The menu's own: the centre behind it stays, and the focus goes back to the button.
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') {
      // A menu is left by Tab, and the focus goes on from the button it came from.
      event.preventDefault();
      onClose(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.shiftKey) {
      event.preventDefault();
      move(event.currentTarget, event.key);
    }
  };

  // The focus left the menu for something that is not the button that opened it (a press elsewhere in the centre, or outside it): the menu closes and the focus stays where the person put it. The button itself is not
  // "elsewhere": its own press asks the menu to close, and a menu that closed first would be opened again by it.
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const to = event.relatedTarget;
    if (to instanceof Element && (event.currentTarget.contains(to) || to.closest('[data-notices-part="filter"]') !== null)) {
      return;
    }

    onClose(false);
  };

  return (
    <div
      ref={menu}
      id={id}
      popover="manual"
      role="menu"
      aria-label="Filter notifications"
      tabIndex={-1}
      className={styles.menu}
      data-notices-part="filterMenu"
      style={{ '--_x': `${String(place.x)}px`, '--_top': `${String(place.top)}px`, '--_max': `${String(place.max)}px` }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div role="group" aria-label="Source" className={styles.menuGroup}>
        <div className={styles.menuTitle} aria-hidden="true">
          Source
        </div>
        {choices.map((choice) => (
          <Item
            key={choice.id}
            role="menuitemradio"
            checked={choice.id === source}
            onSelect={() => {
              onChoose(choice.id);
            }}
          >
            {choice.label}
          </Item>
        ))}
      </div>
      {source === '' ? null : (
        <>
          <div role="separator" className={styles.menuSeparator} />
          <Item role="menuitem" icon={muted ? 'bell' : 'bell-off'} onSelect={onMute}>
            {muted ? `Unmute ${name}` : `Mute ${name} for 1 hour`}
          </Item>
          <Item role="menuitem" icon="close" onSelect={onClear}>
            Clear filters
          </Item>
        </>
      )}
    </div>
  );
}
