import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './ProgressBar.module.css';

export type ProgressBarProps = {
  /** The accessible name of the work. The bar does not draw a label. */
  readonly label: string;
  /** A percentage, clamped to 0–100. Use 'indeterminate' when progress is not measurable; NaN is also indeterminate. */
  readonly value: number | 'indeterminate';
  /** The accessible value in the caller's words, such as "2 of 5 files". */
  readonly valueText?: string | undefined;
  /** Use the secondary text colour and stop indeterminate motion. The caller owns the paused status text. */
  readonly paused?: boolean | undefined;
  /** Animate an indeterminate fill as a full-width stripe (default) or a sweeping segment. */
  readonly indeterminateMotion?: 'stripe' | 'sweep' | undefined;
} & DataAttributes;

/** A 4 px progress track. Props are closed: no className, style or children; data-* passes through. */
export function ProgressBar({ label, value, valueText, paused, indeterminateMotion = 'stripe', ...rest }: ProgressBarProps) {
  const percent = value === 'indeterminate' || Number.isNaN(value) ? undefined : Math.min(100, Math.max(0, value));
  const indeterminate = percent === undefined;

  return (
    <div
      {...dataAttributes(rest)}
      className={styles.root}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      data-ov-part="progress-bar"
      data-ov-indeterminate={indeterminate ? 'true' : undefined}
      data-ov-motion={indeterminate ? indeterminateMotion : undefined}
      data-ov-paused={paused === true ? 'true' : undefined}
    >
      <span className={styles.fill} aria-hidden="true" data-ov-part="fill" style={{ '--_percent': percent }} />
    </div>
  );
}
