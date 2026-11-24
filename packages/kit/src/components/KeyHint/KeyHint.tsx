import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './KeyHint.module.css';

export type KeyHintProps = {
  /** The chord as displayed. Supply the platform's notation; the part does not format it. */
  readonly keys: string;
  /** Words spoken instead of the displayed keys, for glyphs that do not read clearly. */
  readonly spokenKeys?: string | undefined;
  /** Action text shown beside the chord. */
  readonly label?: string | undefined;
} & DataAttributes;

/** Plain keyboard text in the surrounding type and color. It does not bind keys or make a control. */
export function KeyHint({ keys, spokenKeys, label, ...rest }: KeyHintProps) {
  const text = spokenKeys === undefined ? keys : (
    <>
      <span aria-hidden="true">{keys}</span>
      <span className={styles.spoken}>{spokenKeys}</span>
    </>
  );
  if (label === undefined) {
    return <kbd {...dataAttributes(rest)} className={styles.chord} dir="ltr">{text}</kbd>;
  }

  return (
    <span {...dataAttributes(rest)} className={styles.pair}>
      <kbd className={styles.chord} dir="ltr">{text}</kbd>
      {' '}
      <span>{label}</span>
    </span>
  );
}
