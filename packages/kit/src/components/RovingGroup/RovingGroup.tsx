import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { SpacingStep } from '../../generated/tokenNames';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { StackAlign } from '../Stack';
import { applyStop, rovingItems, settle } from './roving';
import styles from './RovingGroup.module.css';

/** Which arrows move the focus: Left and Right in a `row`, Up and Down in a `column`. Home and End go to the ends in both. */
export type RovingGroupKind = 'row' | 'column';

export type RovingGroupProps = {
  /** The group's accessible name: what the items are for. Required: an unnamed group is a defect (design 14 P6, 15 L6). */
  readonly label: string;
  readonly kind?: RovingGroupKind | undefined;
  /** Space between the items, one step of the closed spacing scale. */
  readonly gap?: SpacingStep | undefined;
  /** Lets the items wrap onto more lines. */
  readonly wrap?: boolean | undefined;
  /** Alignment on the cross axis. */
  readonly align?: StackAlign | undefined;
  /**
   * `group` (the default) or `toolbar`: the ARIA pattern of a set of controls that is one Tab stop and moves by arrows. The keys and the Tab stop are the same either way; a toolbar also says its orientation (a
   * column is vertical, a row horizontal), as the mock's panel toolbar does (`role="toolbar" aria-orientation="vertical"`).
   */
  readonly role?: 'group' | 'toolbar' | undefined;
  readonly children?: ReactNode;
} & DataAttributes;

/**
 * A dense set of buttons or links as one tab stop (design 14 P6, 15 L6). Exactly one item is in the tab order: the one that last had
 * the focus, else the pressed one, else the first. Tab leaves the group; the arrows of its axis move the focus and do not wrap; Home
 * and End go to the ends. An item that is unavailable for a reason (`aria-disabled`) stays reachable; one that is natively disabled
 * or hidden is skipped. It acts on the elements it holds, so any part with a button or a link can be a member. Props are closed:
 * no `className`, no `style`; `data-*` passes through.
 */
export function RovingGroup({ label, kind = 'row', role = 'group', gap, wrap, align, children, ...rest }: RovingGroupProps) {
  // Only the two roles the type allows: a value that is neither (the part is closed to what its type does not say) is the group it was.
  const toolbar = role === 'toolbar';
  const host = useRef<HTMLDivElement | null>(null);
  // The index of the item that last had the focus: the tab stop for as long as it is still an item.
  const remembered = useRef<number | null>(null);

  // After every render exactly one item is in the tab order. This writes only where an attribute differs.
  useLayoutEffect(() => {
    if (host.current !== null) {
      settle(host.current, remembered.current);
    }
  });

  // A child that adds an item or changes its pressed state on its own does not render the group: the DOM says so instead.
  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      settle(element, remembered.current);
    });
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current', 'aria-selected', 'aria-checked', 'disabled', 'hidden'] });
    return () => {
      observer.disconnect();
    };
  }, []);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const items = rovingItems(event.currentTarget);
    const at = items.indexOf(event.target);
    if (at >= 0) {
      remembered.current = at;
      applyStop(items, at);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key that something else took, a composition, and a chord are not the group's.
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    const { key } = event;
    if (event.ctrlKey && key !== 'Home' && key !== 'End') {
      return;
    }

    const back = kind === 'row' ? 'ArrowLeft' : 'ArrowUp';
    const forward = kind === 'row' ? 'ArrowRight' : 'ArrowDown';
    if (key !== back && key !== forward && key !== 'Home' && key !== 'End') {
      return;
    }

    const items = rovingItems(event.currentTarget);
    const at = items.indexOf(event.target as HTMLElement);
    if (at < 0) {
      return;
    }

    // The key is the group's even at an end, where nothing moves.
    event.preventDefault();
    const last = items.length - 1;
    const to = key === 'Home' ? 0 : key === 'End' ? last : key === back ? Math.max(0, at - 1) : Math.min(last, at + 1);
    const target = items[to];
    if (target !== undefined && to !== at) {
      target.focus({ preventScroll: true });
      remembered.current = to;
      applyStop(items, to);
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };

  return (
    <div
      {...dataAttributes(rest)}
      ref={host}
      className={styles.root}
      role={toolbar ? 'toolbar' : 'group'}
      aria-label={label}
      aria-orientation={toolbar ? (kind === 'column' ? 'vertical' : 'horizontal') : undefined}
      data-ov-roving={kind}
      data-ov-gap={gap}
      data-ov-wrap={wrap === true ? 'true' : undefined}
      data-ov-align={align}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
