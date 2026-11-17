import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './MissingValue.module.css';

const DEFAULT_NAME = 'Not applicable';

export type MissingValueProps = {
  /** What is missing, in words: the dash's accessible name ("Not applicable", "No value"). The words are never drawn. */
  readonly name?: string | undefined;
  /** Why it is missing. It is part of the accessible name, so a keyboard or a screen reader reaches it without a hover. Where it is shown is the shared tip host's. */
  readonly reason?: string | undefined;
} & DataAttributes;

/**
 * A value that is missing or does not apply: the muted dash of the design (13 D7, V7, SR2), never zero, an invented value or a phrase
 * such as Unknown, Not applicable or Not reported. It reads as an image named by what is missing and, when there is one, why. Props
 * are closed: no `className`, no `style`; `data-*` passes through. The dash takes the type of the cell it sits in.
 */
export function MissingValue({ name, reason, ...rest }: MissingValueProps) {
  const what = name === undefined || name.trim() === '' ? DEFAULT_NAME : name;
  const why = reason?.trim();

  return (
    <span {...dataAttributes(rest)} className={styles.root} role="img" aria-label={why === undefined || why === '' ? what : `${what}: ${why}`}>
      —
    </span>
  );
}
