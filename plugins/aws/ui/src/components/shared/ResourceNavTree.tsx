import React from 'react';
import { TreeList } from '@omniviewdev/base-ui';

export type NavMenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: NavMenuItem[];
};

export type NavSection = {
  title: string;
  items: NavMenuItem[];
};

type Props = {
  sections: NavSection[];
  selected?: string;
  onSelect: (id: string) => void;
  initialExpandedState?: Record<string, boolean>;
  onExpandedChange?: (state: Record<string, boolean>) => void;
  style?: React.CSSProperties;
};

const toSet = (state?: Record<string, boolean>) =>
  new Set(Object.entries(state ?? {}).filter(([, v]) => v).map(([k]) => k));

/**
 * Sidebar resource navigation tree (replaces the old NavMenu) built on base-ui TreeList.
 * Clicking a branch toggles it; clicking a leaf selects it.
 */
const ResourceNavTree: React.FC<Props> = ({
  sections,
  selected,
  onSelect,
  initialExpandedState,
  onExpandedChange,
  style,
}) => {
  const items = React.useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => toSet(initialExpandedState));

  const updateExpanded = React.useCallback((next: ReadonlySet<string>) => {
    setExpanded(next);
    if (onExpandedChange) {
      const state: Record<string, boolean> = {};
      next.forEach((k) => { state[k] = true; });
      onExpandedChange(state);
    }
  }, [onExpandedChange]);

  const toggle = React.useCallback((key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateExpanded(next);
  }, [expanded, updateExpanded]);

  const selectedKeys = React.useMemo(() => new Set(selected ? [selected] : []), [selected]);

  return (
    <TreeList.Root<NavMenuItem>
      items={items}
      itemKey={(item) => item.id}
      getChildren={(item) => item.children ?? []}
      isBranch={(item) => !!item.children?.length}
      getTextValue={(item) => item.label}
      expandedKeys={expanded as ReadonlySet<string>}
      onExpandedKeysChange={(keys) => updateExpanded(new Set(Array.from(keys, String)))}
      selectionMode='single'
      selectedKeys={selectedKeys}
      onSelectedKeysChange={(keys) => {
        const key = Array.from(keys)[0];
        if (key === undefined) return;
        const id = String(key);
        if (!isBranchId(items, id)) onSelect(id);
      }}
      size='sm'
      density='compact'
      style={{ flex: 1, minHeight: 0, overflow: 'auto', ...style }}
      renderItem={(item, node) => (
        <TreeList.Item
          itemKey={node.key}
          textValue={item.label}
          onClick={node.isBranch ? () => toggle(item.id) : undefined}
        >
          <TreeList.ItemIndent depth={node.depth} ancestorIsLast={node.ancestorIsLast} isLastChild={node.isLastChild} />
          <TreeList.ItemToggle itemKey={node.key} />
          {item.icon && <TreeList.ItemIcon>{item.icon}</TreeList.ItemIcon>}
          <TreeList.ItemLabel>{item.label}</TreeList.ItemLabel>
        </TreeList.Item>
      )}
    >
      <TreeList.Viewport />
    </TreeList.Root>
  );
};

function findItem(items: NavMenuItem[], id: string): NavMenuItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const found = item.children ? findItem(item.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

function isBranchId(items: NavMenuItem[], id: string): boolean {
  return !!findItem(items, id)?.children?.length;
}

export default ResourceNavTree;
