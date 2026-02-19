import React from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

type ColorName = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

/** Map semantic color names to CSS color values */
const colorToCss: Record<ColorName, string> = {
  success: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  danger: 'var(--ov-danger-default)',
  primary: 'var(--ov-accent)',
  neutral: 'var(--ov-fg-muted)',
};

type Props = {
  /** The values to use for calculating the badge colors */
  values: string[];
  /** Specify mapping of values to badges that will change with the input */
  colorMap: Record<string, ColorName>;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center' | 'justify';
  /** The contents to put in the menu on hover, if any */
  hoverMenu?: (value: string) => React.ReactNode;
  /** The time to wait before showing the hover menu, in ms. Defaults to 200ms */
  hoverMenuDelay?: number;
};

/**
 * Render a list of colored badge dots for the generic resource table.
 */
export const BadgesCell: React.FC<Props> = ({ align, values, colorMap, hoverMenu, hoverMenuDelay }) => {
  const getColor = (value: string): string => colorToCss[colorMap[value] ?? 'neutral'];

  const getAlignment = () => {
    switch (align) {
      case 'left':    return 'flex-start';
      case 'right':   return 'flex-end';
      case 'center':  return 'center';
      case 'justify': return 'space-between';
      default:        return 'flex-start';
    }
  };

  const delay = hoverMenuDelay ?? 200;

  const Badge = ({ color }: { color: string }) => (
    <Box
      sx={{
        borderRadius: '2px',
        width: 12, height: 12,
        minWidth: 12, minHeight: 12,
        bgcolor: color,
      }}
    />
  );

  return (
    <Box
      display="flex"
      flex={1}
      justifyContent={getAlignment()}
      alignItems="center"
      gap={0.25}
    >
      {values.map((value, idx) => (
        hoverMenu ? (
          <Tooltip
            key={`badge-${idx}`}
            title={hoverMenu(value)}
            enterDelay={delay}
            slotProps={{
              tooltip: {
                sx: {
                  p: 1,
                  border: '1px solid var(--ov-border-default)',
                  bgcolor: 'var(--ov-bg-surface-overlay)',
                  color: 'var(--ov-fg-default)',
                },
              },
            }}
          >
            <Badge color={getColor(value)} />
          </Tooltip>
        ) : (
          <Badge key={`badge-${idx}`} color={getColor(value)} />
        )
      ))}
    </Box>
  );
};

BadgesCell.displayName = 'BadgesCell';

export default BadgesCell;
