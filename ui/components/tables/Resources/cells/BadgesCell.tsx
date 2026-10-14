import React from 'react';

import HintTooltip from '@/components/base/HintTooltip';
import styles from './cells.module.css';

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

  const hoverMenuDelayValue = hoverMenuDelay ?? 200;

  return (
    <div className={styles.Cell} data-align={align ?? 'left'}>
      {values.map((value, idx) => (
        hoverMenu ? (
          <HintTooltip
            key={`badge-${idx}`}
            content={hoverMenu(value)}
            delay={hoverMenuDelayValue}
          >
            <span className={styles.Badge} data-color={getColor(value)} />
          </HintTooltip>
        ) : (
          <span
            key={`badge-${idx}`}
            className={styles.Badge}
            data-color={getColor(value)}
          />
        )
      ))}
    </div>
  );
};

export default BadgesCell;
