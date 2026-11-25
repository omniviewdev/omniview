import type { MenuAction, MenuItem } from '../Menu';

/**
 * One entry of the header's overflow menu, as a caller gives it (and as a secondary command that did not fit becomes). It reuses the
 * kit Menu's action fields: the 16 px `icon`, and a `disabled` that is a boolean or the reason the entry cannot be used (shown as its tip).
 */
export type OverflowEntry = Pick<MenuAction, 'id' | 'label' | 'icon' | 'disabled' | 'destructive' | 'onSelect'> & {
  /** A separator before the entry, to set a group apart. */
  readonly separatorBefore?: boolean | undefined;
};

/** Whether an entry cannot be used: the Menu reads `true` and any reason the same way. */
export const isDisabled = (entry: Pick<OverflowEntry, 'disabled'>): boolean => entry.disabled === true || typeof entry.disabled === 'string';

/**
 * The items of the overflow menu (design 14 PX1, shell-page-kit.js `menuItems`): no entry that is also a visible command; the
 * destructive ones last, behind one separator; no separator at the start of the menu and none twice in a row.
 */
export function overflowItems(entries: readonly OverflowEntry[], visible: ReadonlySet<string>, select: (id: string) => void): MenuItem[] {
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
      icon: entry.icon,
      disabled: entry.disabled ?? false,
      destructive: entry.destructive === true,
    });
  }

  return items;
}
