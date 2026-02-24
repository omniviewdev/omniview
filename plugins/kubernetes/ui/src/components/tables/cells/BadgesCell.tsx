import React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Tooltip } from '@omniviewdev/ui/overlays';

type Props = {
  values: string[];
  colorMap: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  align?: 'left' | 'right' | 'center' | 'justify';
  hoverMenu?: (value: string) => React.ReactNode;
  hoverMenuDelay?: number;
};

export const BadgesCell: React.FC<Props> = ({ align, values, colorMap, hoverMenu }) => {
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
            content={hoverMenu(value)}
          >
            <Chip
              size='sm'
              emphasis='solid'
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
              label=''
            />
          </Tooltip>
        ) : (
          <Chip
            key={`badge-${idx}`}
            size='sm'
            emphasis='solid'
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
            label=''
          />
        )
      ))}
    </Box>
  );
};

export default BadgesCell;
