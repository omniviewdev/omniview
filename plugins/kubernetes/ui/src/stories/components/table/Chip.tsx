import React from 'react';

// material ui
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import DynamicIcon from '../DynamicIcon';

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
export const ChipRow: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator, variant }) => {
  const getColor = () => {
    if (colorMap) {
      return colorMap[value] || 'neutral';
    }
    return color || 'neutral';
  }

  const getVariant = () => {
    if (variant) {
      return variant === 'outlined' ? 'outline' : 'soft';
    }
    return 'soft';
  }

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
  }

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
      emphasis={getVariant()}
      sx={{
        borderRadius: "sm",
      }}
      startAdornment={
        typeof startDecorator === "string" ? <DynamicIcon name={startDecorator} size={16} /> : startDecorator
      }
      endAdornment={
        typeof endDecorator === "string" ? <DynamicIcon name={endDecorator} size={16} /> : endDecorator
      }
      label={<Text weight="semibold" size="sm">{value}</Text>}
    />
    </Box>
);
}

export default ChipRow;
