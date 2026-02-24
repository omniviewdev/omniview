import React from 'react';

// material ui
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';

// project imports
import Icon from '@/components/icons/Icon';

type Props = {
  value: string;
  color?: 'success' | 'warning' | 'danger' | 'primary' | 'neutral';
  colorMap?: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'neutral'>;
  startDecorator?: string | React.ReactNode;
  endDecorator?: string | React.ReactNode;
  align?: 'left' | 'right' | 'center';
  variant?: 'soft' | 'outlined';
};

/**
 * Renders a row with a chip inside for the generic resource table.
 */
export const ChipCell: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator, variant }) => {
  const getColor = () => {
    if (colorMap) {
      return colorMap[value] || 'neutral';
    }

    return color ?? 'neutral';
  };

  const getEmphasis = () => {
    if (variant === 'outlined') {
      return 'outline';
    }
    if (variant === 'soft') {
      return 'soft';
    }

    return 'soft';
  };

  const getAlignment = () => {
    if (align) {
      switch (align) {
        case 'left':
          return 'flex-start';
        case 'right':
          return 'flex-end';
        case 'center':
          return 'center';
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
      <Chip
        size="sm"
        color={getColor()}
        emphasis={getEmphasis()}
        sx={{
          borderRadius: 'sm',
        }}
        icon={
          typeof startDecorator === 'string' ? <Icon name={startDecorator} size={16} /> : startDecorator
        }
        action={
          typeof endDecorator === 'string' ? <Icon name={endDecorator} size={16} /> : endDecorator
        }
        label={value}
      />
    </Box>
  );
};

export default ChipCell;
