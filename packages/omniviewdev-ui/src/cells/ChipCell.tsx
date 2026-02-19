import React from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';

import Icon from '../components/Icon';

type ColorName = 'success' | 'warning' | 'danger' | 'primary' | 'neutral';

/** Map Joy-style color names to Material UI Chip color prop values */
const mapColor = (color: ColorName): 'success' | 'warning' | 'error' | 'primary' | 'default' => {
  switch (color) {
    case 'success': return 'success';
    case 'warning': return 'warning';
    case 'danger':  return 'error';
    case 'primary': return 'primary';
    case 'neutral': return 'default';
    default:        return 'default';
  }
};

/** Map Joy-style variant names to Material UI Chip variant prop values */
const mapVariant = (variant: 'soft' | 'outlined' | undefined): 'filled' | 'outlined' => {
  switch (variant) {
    case 'outlined': return 'outlined';
    case 'soft':
    default:         return 'filled';
  }
};

type Props = {
  value: string;
  color?: ColorName;
  colorMap?: Record<string, ColorName>;
  startDecorator?: string | React.ReactNode;
  endDecorator?: string | React.ReactNode;
  align?: 'left' | 'right' | 'center';
  variant?: 'soft' | 'outlined';
};

/**
 * Renders a row with a chip inside for the generic resource table.
 */
export const ChipCell: React.FC<Props> = ({ align, value, color, colorMap, startDecorator, endDecorator, variant }) => {
  const getColor = (): ColorName => {
    if (colorMap) return colorMap[value] || 'neutral';
    return color ?? 'neutral';
  };

  const getAlignment = () => {
    switch (align) {
      case 'left':   return 'flex-start';
      case 'right':  return 'flex-end';
      case 'center': return 'center';
      default:       return 'flex-start';
    }
  };

  const resolvedStartDecorator = typeof startDecorator === 'string'
    ? <Icon name={startDecorator} size={16} />
    : startDecorator;

  const resolvedEndDecorator = typeof endDecorator === 'string'
    ? <Icon name={endDecorator} size={16} />
    : endDecorator;

  return (
    <Box
      display="flex"
      flex={1}
      justifyContent={getAlignment()}
      alignItems="center"
    >
      <Chip
        size="small"
        color={mapColor(getColor())}
        variant={mapVariant(variant)}
        sx={{ borderRadius: '4px' }}
        icon={resolvedStartDecorator as React.ReactElement | undefined}
        label={
          resolvedEndDecorator ? (
            <Box display="flex" alignItems="center" gap={0.5}>
              {value}
              {resolvedEndDecorator}
            </Box>
          ) : value
        }
      />
    </Box>
  );
};

ChipCell.displayName = 'ChipCell';

export default ChipCell;
