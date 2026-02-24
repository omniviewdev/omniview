import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePluginData } from '@omniviewdev/runtime';
import type { NavSection, NavMenuItem } from '@omniviewdev/ui/sidebars';
import type { CommandItem } from '@omniviewdev/ui/editors';

const MAX_RECENT = 8;

/**
 * Recursively flatten NavSection[] into CommandItem[].
 * Leaf items (no children) become palette entries.
 * Parent items become category labels for their children.
 * Nested groups (e.g. CRD sub-groups) are handled recursively.
 */
function flattenSections(sections: NavSection[]): { items: CommandItem[]; categories: string[] } {
  const items: CommandItem[] = [];
  const categorySet = new Set<string>();

  function walkChildren(children: NavMenuItem[], category: string) {
    for (const child of children) {
      if (child.children && child.children.length > 0) {
        // This is a sub-group (e.g. a CRD group like cert-manager.io)
        categorySet.add(child.label);
        walkChildren(child.children, child.label);
      } else {
        // Leaf item — this is a navigable resource type
        categorySet.add(category);
        items.push({
          id: child.id,
          label: child.label,
          icon: child.icon,
          category,
          description: formatDescription(child.id),
        });
      }
    }
  }

  for (const section of sections) {
    for (const item of section.items) {
      if (item.children && item.children.length > 0) {
        // Parent with children — use its label as category
        walkChildren(item.children, item.label);
      } else {
        // Top-level leaf (e.g. Nodes, Events, Namespaces)
        const cat = section.title || 'General';
        categorySet.add(cat);
        items.push({
          id: item.id,
          label: item.label,
          icon: item.icon,
          category: cat,
          description: formatDescription(item.id),
        });
      }
    }
  }

  return { items, categories: Array.from(categorySet).sort() };
}

/**
 * Derive a human-readable API group/version description from the resource ID.
 * IDs follow the pattern: group_version_kind (e.g. "apps_v1_Deployment", "core_v1_Pod")
 */
function formatDescription(id: string): string {
  const parts = id.split('_');
  if (parts.length < 3) return '';
  const [group, version] = parts;
  if (group === 'core' || group === 'events') return `${group}/${version}`;
  return `${group}/${version}`;
}

type UseResourceCommandPaletteOpts = {
  connectionID: string;
  layout: NavSection[];
  onSelect: (resourceID: string) => void;
};

export function useResourceCommandPalette({ connectionID, layout, onSelect }: UseResourceCommandPaletteOpts) {
  const [open, setOpen] = useState(false);

  const {
    data: recentIDs,
    update: setRecentIDs,
  } = usePluginData<string[]>('kubernetes', `palette_recent_${connectionID}`, []);

  // Flatten layout into palette items
  const { items, categories } = useMemo(() => flattenSections(layout), [layout]);

  // Build recent CommandItems from stored IDs
  const recentItems = useMemo(() => {
    const itemMap = new Map(items.map((it) => [it.id, it]));
    return recentIDs
      .map((id) => itemMap.get(id))
      .filter((it): it is CommandItem => it !== undefined);
  }, [recentIDs, items]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    (item: CommandItem) => {
      // Update recents: prepend, dedupe, cap
      const updated = [item.id, ...recentIDs.filter((id) => id !== item.id)].slice(0, MAX_RECENT);
      setRecentIDs(updated);

      onSelect(item.id);
      setOpen(false);
    },
    [recentIDs, setRecentIDs, onSelect],
  );

  return {
    open,
    handleClose,
    handleSelect,
    items,
    categories,
    recentItems,
  };
}
