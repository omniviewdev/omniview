import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';

export interface TruncatedListProps {
  items: React.ReactNode[];
  maxVisible?: number;
  renderItem?: (item: React.ReactNode, index: number) => React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function TruncatedList({
  items,
  maxVisible = 3,
  renderItem,
  sx,
}: TruncatedListProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleItems = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - maxVisible;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        flexWrap: 'wrap',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {visibleItems.map((item, index) =>
        renderItem ? renderItem(item, index) : (
          <Box key={index} component="span">{item}</Box>
        )
      )}

      {!expanded && hiddenCount > 0 && (
        <Chip
          label={`+${hiddenCount} more`}
          size="small"
          onClick={() => setExpanded(true)}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            height: 20,
            cursor: 'pointer',
            bgcolor: 'var(--ov-bg-surface-inset)',
            color: 'var(--ov-fg-muted)',
            '&:hover': { bgcolor: 'var(--ov-state-hover)' },
          }}
        />
      )}

      {expanded && hiddenCount > 0 && (
        <Chip
          label="Show less"
          size="small"
          onClick={() => setExpanded(false)}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            height: 20,
            cursor: 'pointer',
            bgcolor: 'var(--ov-bg-surface-inset)',
            color: 'var(--ov-fg-muted)',
            '&:hover': { bgcolor: 'var(--ov-state-hover)' },
          }}
        />
      )}
    </Box>
  );
}

TruncatedList.displayName = 'TruncatedList';
