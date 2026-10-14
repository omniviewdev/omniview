import React from 'react';

import { Chip, type ComponentColor } from '@omniviewdev/base-ui';

// project imports
import Icon from '@/components/icons/Icon';
import styles from './cells.module.css';

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
  const getColor = (): ComponentColor => {
    const resolved = colorMap ? (colorMap[value] || 'neutral') : (color ?? 'neutral');
    return resolved === 'primary' ? 'brand' : resolved;
  };

  const getVariant = () => {
    if (variant === 'outlined') {
      return 'outline';
    }

    return 'soft';
  };

  return (
    <div className={styles.Cell} data-align={align ?? 'left'}>
      <Chip
        size="sm"
        color={getColor()}
        variant={getVariant()}
        className={styles.Chip}
        startDecorator={
          typeof startDecorator === 'string' ? <Icon name={startDecorator} size={16} /> : startDecorator
        }
        endDecorator={
          typeof endDecorator === 'string' ? <Icon name={endDecorator} size={16} /> : endDecorator
        }
      >
        {value}
      </Chip>
    </div>
  );
};

export default ChipCell;
