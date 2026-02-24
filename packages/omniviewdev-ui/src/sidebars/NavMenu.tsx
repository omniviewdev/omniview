import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';
import type { NavSection, NavMenuItem as NavMenuItemType } from './types';

export interface NavMenuProps {
  sections: NavSection[];
  selected?: string;
  onSelect?: (id: string) => void;
  size?: ComponentSize;
  /** Make the menu scrollable within its container. */
  scrollable?: boolean;
  /** Start all collapsible items expanded. Defaults to false. */
  defaultExpanded?: boolean;
  /** Animate expand/collapse transitions. Defaults to true. */
  animate?: boolean;
  /** Initial expanded state to merge over computed defaults (e.g. from persistence). */
  initialExpandedState?: Record<string, boolean>;
  /** Called whenever expanded state changes (for external persistence). */
  onExpandedChange?: (state: Record<string, boolean>) => void;
  sx?: SxProps<Theme>;
}

const fontSizeMap: Record<ComponentSize, number> = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 15,
};

const CHEVRON_SIZE = 12;
const CHEVRON_SLOT = 14; // tight gutter for the expand/collapse arrow
const INDENT = 10; // per-depth indent in px for child items

/** Collect IDs of all items that have children. */
function getAllExpandable(sections: NavSection[]): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  function walk(items: NavMenuItemType[]) {
    for (const item of items) {
      if (item.children && item.children.length > 0) state[item.id] = true;
      if (item.children) walk(item.children);
    }
  }
  for (const section of sections) walk(section.items);
  return state;
}

/** Collect only items that explicitly set defaultExpanded. */
function getExplicitExpanded(sections: NavSection[]): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  function walk(items: NavMenuItemType[]) {
    for (const item of items) {
      if (item.defaultExpanded) state[item.id] = true;
      if (item.children) walk(item.children);
    }
  }
  for (const section of sections) walk(section.items);
  return state;
}

/** Walk the section tree and return IDs of all ancestor items containing the target. */
export function findAncestors(sections: NavSection[], targetId: string): string[] {
  const path: string[] = [];

  function walk(items: NavMenuItemType[]): boolean {
    for (const item of items) {
      if (item.id === targetId) return true;
      if (item.children && item.children.length > 0) {
        path.push(item.id);
        if (walk(item.children)) return true;
        path.pop();
      }
    }
    return false;
  }

  for (const section of sections) {
    if (walk(section.items)) return [...path];
    path.length = 0;
  }
  return [];
}

function NavMenuItemComponent({
  item,
  depth,
  selected,
  onSelect,
  fontSize,
  expandedState,
  onToggleExpanded,
  animate,
}: {
  item: NavMenuItemType;
  depth: number;
  selected?: string;
  onSelect?: (id: string) => void;
  fontSize: number;
  expandedState: Record<string, boolean>;
  onToggleExpanded: (id: string) => void;
  animate: boolean;
}) {
  const isExpanded = expandedState[item.id] ?? false;
  const isSelected = selected === item.id;
  const hasChildren = item.children && item.children.length > 0;

  const childContent = hasChildren && item.children && (
    <>
      {item.children.map((child) => (
        <NavMenuItemComponent
          key={child.id}
          item={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          fontSize={fontSize}
          expandedState={expandedState}
          onToggleExpanded={onToggleExpanded}
          animate={animate}
        />
      ))}
    </>
  );

  return (
    <Box>
      <Box
        onClick={() => {
          if (item.disabled) return;
          if (hasChildren) {
            onToggleExpanded(item.id);
          } else {
            onSelect?.(item.id);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          pl: `${depth * INDENT + 4}px`,
          pr: '6px',
          py: '3px',
          cursor: item.disabled ? 'default' : 'pointer',
          opacity: item.disabled ? 0.5 : 1,
          borderRadius: '4px',
          mx: '4px',
          my: '1px',
          bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'transparent',
          color: isSelected ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
          fontWeight: isSelected ? 600 : hasChildren ? 500 : 400,
          '&:hover': {
            bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
          },
        }}
      >
        {/* Fixed-width chevron slot — always takes space so icons/text align */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: CHEVRON_SLOT,
            minWidth: CHEVRON_SLOT,
            flexShrink: 0,
            color: 'var(--ov-fg-faint)',
          }}
        >
          {hasChildren && (isExpanded
            ? <LuChevronDown size={CHEVRON_SIZE} />
            : <LuChevronRight size={CHEVRON_SIZE} />
          )}
        </Box>
        {item.icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: fontSize + 2 }}>
            {item.icon}
          </Box>
        )}
        <Typography
          variant="body2"
          sx={{ flex: 1, fontSize, color: 'inherit', fontWeight: 'inherit' }}
          noWrap
        >
          {item.label}
        </Typography>
        {item.badge}
      </Box>
      {hasChildren && (
        animate
          ? <Collapse in={isExpanded} unmountOnExit>{childContent}</Collapse>
          : isExpanded ? childContent : null
      )}
    </Box>
  );
}

const scrollableSx = {
  overflow: 'auto',
  maxHeight: '100%',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'none' as const,
  '&::-webkit-scrollbar': { display: 'none' },
};

export default function NavMenu({
  sections,
  selected,
  onSelect,
  size = 'md',
  scrollable,
  defaultExpanded = false,
  animate = true,
  initialExpandedState,
  onExpandedChange,
  sx,
}: NavMenuProps) {
  const fontSize = fontSizeMap[size];

  const computeExpanded = useMemo(
    () => (defaultExpanded ? getAllExpandable(sections) : getExplicitExpanded(sections)),
    [sections, defaultExpanded],
  );

  const [expandedState, setExpandedState] = useState<Record<string, boolean>>(() => ({
    ...computeExpanded,
    ...(initialExpandedState ?? {}),
  }));

  // Notify parent of state changes
  const onExpandedChangeRef = useRef(onExpandedChange);
  onExpandedChangeRef.current = onExpandedChange;

  const updateExpanded = useCallback((updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
    setExpandedState((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        onExpandedChangeRef.current?.(next);
      }
      return next;
    });
  }, []);

  // When sections change (e.g. async data load), merge new expandable items into state.
  // Preserve existing state for known keys; only apply defaults for new keys.
  const prevSectionsRef = useRef(sections);
  useEffect(() => {
    if (prevSectionsRef.current !== sections) {
      prevSectionsRef.current = sections;
      updateExpanded((prev) => {
        const newDefaults = computeExpanded;
        const merged = { ...prev };
        let changed = false;
        for (const key of Object.keys(newDefaults)) {
          if (!(key in merged)) {
            merged[key] = newDefaults[key];
            changed = true;
          }
        }
        return changed ? merged : prev;
      });
    }
  }, [sections, computeExpanded, updateExpanded]);

  // Auto-expand ancestors when selected item changes
  useEffect(() => {
    if (!selected) return;
    const ancestors = findAncestors(sections, selected);
    if (ancestors.length > 0) {
      updateExpanded((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of ancestors) {
          if (!next[id]) {
            next[id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [selected, sections, updateExpanded]);

  const handleToggle = useCallback((id: string) => {
    updateExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, [updateExpanded]);

  const rootSx = scrollable ? { ...scrollableSx, ...sx as Record<string, unknown> } : sx;

  return (
    <Box sx={rootSx}>
      {sections.map((section, i) => (
        <Box key={section.title || `section-${i}`} sx={{ mb: 0.5, mt: i === 0 ? 0 : 0.25 }}>
          {section.title && (
            <Typography
              variant="overline"
              sx={{
                display: 'block',
                px: '12px',
                py: '4px',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'var(--ov-fg-faint)',
                textTransform: 'uppercase',
              }}
            >
              {section.title}
            </Typography>
          )}
          {section.items.map((item) => (
            <NavMenuItemComponent
              key={item.id}
              item={item}
              depth={0}
              selected={selected}
              onSelect={onSelect}
              fontSize={fontSize}
              expandedState={expandedState}
              onToggleExpanded={handleToggle}
              animate={animate}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

NavMenu.displayName = 'NavMenu';
