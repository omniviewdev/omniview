import type { MenuItem } from '../Menu';

/** One entry of the header's overflow menu, as a caller gives it (and as a secondary command that did not fit becomes). */
export type MenuEntry = {
  /** Names the entry among its siblings. An entry whose id is the id of a visible command is dropped: a menu never repeats a button. */
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean | undefined;
  /** The entry destroys something: drawn in the error colour, and moved last, behind one separator. */
  readonly destructive?: boolean | undefined;
  /** A separator before the entry, to set a group apart. */
  readonly separatorBefore?: boolean | undefined;
};

/**
 * The items of the overflow menu (design 14 PX1, shell-page-kit.js `menuItems`): no entry that is also a visible command; the
 * destructive ones last, behind one separator; no separator at the start of the menu and none twice in a row.
 */
export function overflowItems(entries: readonly MenuEntry[], visible: ReadonlySet<string>, select: (id: string) => void): MenuItem[] {
  const kept = entries.filter((entry) => !visible.has(entry.id));
  const plain = kept.filter((entry) => entry.destructive !== true);
  const destructive = kept.filter((entry) => entry.destructive === true);

  const items: MenuItem[] = [];
  for (const [index, entry] of [...plain, ...destructive].entries()) {
    if (index > 0 && (entry.separatorBefore === true || index === plain.length)) {
      items.push({ kind: 'separator', id: `separator:${entry.id}` });
    }

    items.push({
      kind: 'action',
      id: `action:${entry.id}`,
      label: entry.label,
      onSelect: () => {
        select(entry.id);
      },
      disabled: entry.disabled === true,
      destructive: entry.destructive === true,
    });
  }

  return items;
}
