import { useState } from 'react';
import Box from '@mui/material/Box';
import { CopyButton } from '@omniviewdev/ui/buttons';
import { LuFilter } from 'react-icons/lu';
import type { CellContext } from '@tanstack/react-table';

/**
 * NamespaceCell renders the namespace value with hover actions:
 * - Copy to clipboard
 * - Filter table to show only this namespace
 */
export const NamespaceCell = <T,>({ getValue, table, column }: CellContext<T, unknown>) => {
  const val = getValue() as string | undefined;
  const [hovered, setHovered] = useState(false);

  if (!val) return null;

  const handleFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    const current = (column.getFilterValue() as string[]) ?? [];
    if (current.includes(val)) {
      // Already filtering by this namespace — remove it
      column.setFilterValue(current.filter((ns: string) => ns !== val));
    } else {
      // Add this namespace to the filter
      column.setFilterValue([...current, val]);
    }
  };

  const isFiltered = ((table.getColumn('namespace')?.getFilterValue() as string[]) ?? []).includes(val);

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {val}
      </span>
      <span
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          gap: 2,
          alignItems: 'center',
          flexShrink: 0,
          visibility: hovered ? 'visible' : 'hidden',
        }}
      >
        <CopyButton value={val} size="xs" />
        <span
          role="button"
          onClick={handleFilter}
          title={isFiltered ? 'Remove namespace filter' : 'Filter by this namespace'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            cursor: 'pointer',
            color: isFiltered ? 'var(--mui-palette-primary-main)' : 'var(--mui-palette-action-active)',
            lineHeight: 0,
          }}
        >
          <LuFilter size={10} />
        </span>
      </span>
    </Box>
  );
};

export default NamespaceCell;
