import { LuStar } from 'react-icons/lu';

import styles from './StarRating.module.css';

type Props = {
  /** Rating value, 0..max. */
  value: number;
  /** Number of stars. */
  max?: number;
  /** Values are rounded to this step (e.g. 0.5 for half stars). */
  precision?: number;
  /** Star size in px. */
  size?: number;
  className?: string;
};

/**
 * Small read-only star rating (replacement for MUI's readOnly `Rating`).
 */
export default function StarRating({ value, max = 5, precision = 1, size = 14, className }: Props) {
  const step = precision > 0 ? precision : 1;
  const rounded = Math.min(max, Math.max(0, Math.round((value || 0) / step) * step));

  return (
    <span
      role='img'
      aria-label={`${rounded} out of ${max} stars`}
      className={className ? `${styles.Root} ${className}` : styles.Root}
    >
      {Array.from({ length: max }, (_, i) => {
        const fill = Math.min(1, Math.max(0, rounded - i));
        return (
          <span key={i} className={styles.Star} style={{ width: size, height: size }} aria-hidden='true'>
            <LuStar size={size} className={styles.Empty} />
            {fill > 0 && (
              <span className={styles.Fill} style={{ width: `${fill * 100}%` }}>
                <LuStar size={size} className={styles.Filled} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
