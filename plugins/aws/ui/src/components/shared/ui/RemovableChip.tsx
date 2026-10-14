import React from 'react';
import { Chip, type ComponentColor, type ComponentVariant } from '@omniviewdev/base-ui';
import { LuX } from 'react-icons/lu';
import styles from './RemovableChip.module.css';

export type RemovableChipProps = {
  children: React.ReactNode;
  color?: ComponentColor;
  variant?: ComponentVariant;
  mono?: boolean;
  /** When given, a small remove button is rendered after the label. */
  onRemove?: () => void;
  removeLabel?: string;
  style?: React.CSSProperties;
};

/** Chip with an optional trailing remove button (replaces MUI Chip `onDelete`). */
export const RemovableChip: React.FC<RemovableChipProps> = ({
  children,
  color = 'neutral',
  variant = 'solid',
  mono,
  onRemove,
  removeLabel = 'Remove',
  style,
}) => (
  <Chip
    size='sm'
    color={color}
    variant={variant}
    mono={mono}
    style={{ borderRadius: 4, ...style }}
    endDecorator={onRemove ? (
      <button
        type='button'
        className={styles.remove}
        aria-label={removeLabel}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <LuX size={12} />
      </button>
    ) : undefined}
  >
    {children}
  </Chip>
);

export default RemovableChip;
