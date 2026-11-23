import type { IconName } from '../Icon';

export type MenuMetadata = {
  readonly text: string;
  readonly icon?: IconName | undefined;
};

export type MenuKeyHint = {
  /** The displayed chord, in the platform's notation. The menu does not bind the chord. */
  readonly keys: string;
  readonly label: string;
  /** Words for a chord whose displayed glyphs would not read clearly. */
  readonly spokenKeys?: string | undefined;
};

export type MenuEntry = {
  /** Stable and unique among siblings. */
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  /** Display text for a shortcut already owned by the application. */
  readonly shortcut?: string | undefined;
  readonly metadata?: string | MenuMetadata | undefined;
  /** Unavailable items never activate. Arrow and page keys skip them; typeahead can focus them. A reason is also shown as a tip. */
  readonly disabled?: boolean | string | undefined;
  readonly destructive?: boolean | undefined;
  /** Key hints shown below the items while this item has focus. */
  readonly hints?: readonly MenuKeyHint[] | undefined;
};

export type MenuAction = MenuEntry & {
  readonly kind: 'action';
  /** Called after the menu closes and gives back focus, so a surface the action opens can take focus. */
  readonly onSelect: () => void;
};

export type MenuCheckbox = MenuEntry & {
  readonly kind: 'checkbox';
  readonly checked: boolean | 'mixed';
  readonly onChange: (checked: boolean) => void;
};

export type MenuRadioOption = MenuEntry;

export type MenuRadioGroup = {
  readonly kind: 'radio';
  readonly id: string;
  readonly label?: string | undefined;
  /** ID of the selected option. */
  readonly value: string;
  readonly options: readonly MenuRadioOption[];
  readonly onChange: (value: string) => void;
};

export type MenuSubmenu = MenuEntry & {
  readonly kind: 'submenu';
  readonly items: readonly MenuItem[];
};

export type MenuGroup = {
  readonly kind: 'group';
  readonly id: string;
  readonly label?: string | undefined;
  readonly items: readonly MenuItem[];
};

export type MenuSeparator = {
  readonly kind: 'separator';
  readonly id: string;
};

export type MenuItem = MenuAction | MenuCheckbox | MenuRadioGroup | MenuSubmenu | MenuGroup | MenuSeparator;

/** A list or a resolver called only on invocation. The open menu keeps that opening's item snapshot. */
export type MenuDefinition = readonly MenuItem[] | ((contextKey: string | undefined) => readonly MenuItem[] | null | undefined);

export type MenuRegistry = Readonly<Record<string, MenuDefinition>>;

export type MenuRow = {
  readonly index: number;
  readonly entry: MenuEntry;
  readonly role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  readonly checked: boolean | 'mixed' | undefined;
  readonly disabled: boolean;
  readonly reason: string | undefined;
} & (
  | { readonly select: () => void; readonly submenu?: never }
  | { readonly select?: never; readonly submenu: readonly MenuItem[] }
);

type MenuNode =
  | { readonly kind: 'row'; readonly row: MenuRow }
  | { readonly kind: 'group'; readonly id: string; readonly label: string | undefined; readonly children: readonly MenuNode[] }
  | MenuSeparator;

export type MenuModel = {
  readonly nodes: readonly MenuNode[];
  readonly rows: readonly MenuRow[];
  readonly mark: boolean;
  readonly icon: boolean;
  readonly arrow: boolean;
  readonly metadataIcon: boolean;
  readonly hinted: readonly MenuRow[];
};

function hasRows(items: readonly MenuItem[]): boolean {
  return items.some((item) => {
    if (item.kind === 'separator') {
      return false;
    }

    if (item.kind === 'group') {
      return hasRows(item.items);
    }

    if (item.kind === 'radio') {
      return item.options.length > 0;
    }

    return true;
  });
}

/** Build only this level. Groups share its navigation order; child menus get their own model when opened. */
export function buildMenu(items: readonly MenuItem[]): MenuModel {
  const rows: MenuRow[] = [];
  const hinted: MenuRow[] = [];
  let mark = false;
  let icon = false;
  let arrow = false;
  let metadataIcon = false;

  function row(entry: MenuEntry, role: MenuRow['role'], checked: MenuRow['checked'], action: (() => void) | readonly MenuItem[]): MenuNode {
    const empty = typeof action !== 'function' && !hasRows(action);
    const reason = typeof entry.disabled === 'string' ? entry.disabled : empty ? 'No options available' : undefined;
    const item: MenuRow = {
      index: rows.length,
      entry,
      role,
      checked,
      disabled: entry.disabled === true || reason !== undefined,
      reason,
      ...(typeof action === 'function' ? { select: action } : { submenu: action }),
    };
    rows.push(item);
    if (entry.hints?.length) {
      hinted.push(item);
    }

    mark ||= checked !== undefined;
    icon ||= entry.icon !== undefined;
    arrow ||= typeof action !== 'function';
    metadataIcon ||= typeof entry.metadata === 'object' && entry.metadata.icon !== undefined;
    return { kind: 'row', row: item };
  }

  function group(entries: readonly MenuItem[]): MenuNode[] {
    const nodes: MenuNode[] = [];
    let separator: MenuSeparator | undefined;
    for (const item of entries) {
      let node: MenuNode;
      switch (item.kind) {
        case 'separator':
          separator ??= item;
          continue;
        case 'group': {
          const children = group(item.items);
          if (children.length === 0) {
            continue;
          }

          node = { kind: 'group', id: item.id, label: item.label, children };
          break;
        }

        case 'radio':
          if (item.options.length === 0) {
            continue;
          }

          node = {
            kind: 'group',
            id: item.id,
            label: item.label,
            children: item.options.map((option) => row(option, 'menuitemradio', item.value === option.id, () => {
              item.onChange(option.id);
            })),
          };
          break;
        case 'checkbox':
          node = row(item, 'menuitemcheckbox', item.checked, () => {
            item.onChange(item.checked !== true);
          });
          break;
        case 'action':
          node = row(item, 'menuitem', undefined, item.onSelect);
          break;
        case 'submenu':
          node = row(item, 'menuitem', undefined, item.items);
          break;
      }

      if (separator !== undefined && nodes.length > 0) {
        nodes.push(separator);
      }

      separator = undefined;
      nodes.push(node);
    }

    return nodes;
  }

  const nodes = group(items);
  return { nodes, rows, mark, icon, arrow, metadataIcon, hinted };
}
