import React from 'react';

// material ui
import {
  Chip,
  Box,
  Tooltip,
} from '@mui/joy';

type Props = {
  /** The values to use for calculating the badge colors */
  values: string[];
  /** Specify mapping of values to badges that will change with the input */
  colorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center' | 'justify';
  /** The contents to put in the menu on hover, if any */
  hoverMenu?: (value: string) => React.ReactNode;
  /** The time to wait before showing the hover menu, in ms. Defaults to 200ms */
  hoverMenuDelay?: number;
};

/** Render a list of badges for the generic resource table. */
export const BadgesCell: React.FC<Props> = ({ align, values, colorMap, hoverMenu, hoverMenuDelay }) => {
  const getColor = (value: string) => colorMap[value] ?? 'neutral';

  const getAlignment = () => {
    if (align) {
      switch (align) {
        case 'left':
          return 'flex-start';
        case 'right':
          return 'flex-end';
        case 'center':
          return 'center';
        case 'justify':
          return 'space-between';
      }
    }

    return 'flex-start';
  };

  const hoverMenuDelayValue = hoverMenuDelay ?? 200;

  return (
    <Box
      display='flex'
      flex={1}
      justifyContent={getAlignment()}
      alignItems='center'
    >
      {values.map((value, idx) => (
        hoverMenu ? (
          <Tooltip
            key={`badge-${idx}`}
            title={hoverMenu(value)}
            size='sm'
            variant='outlined'
            color='neutral'
            enterDelay={hoverMenuDelayValue}
            sx={{ p: 1 }}
          >
            <Chip
              size='sm'
              variant='solid'
              color={getColor(value)}
              sx={{
                borderRadius: 2,
                width: 12,
                height: 12,
                maxWidth: 12,
                maxHeight: 12,
                minWidth: 12,
                minHeight: 12,
              }}
            />
          </Tooltip>
        ) : (
          <Chip
            key={`badge-${idx}`}
            size='sm'
            variant='solid'
            color={getColor(value)}
            sx={{
              borderRadius: 2,
              width: 12,
              height: 12,
              wmaxWidth: 12,
              maxHeight: 12,
              minWidth: 12,
              minHeight: 12,
            }}
          />
        )
      ))}
    </Box>
  );
};

export default BadgesCell;
