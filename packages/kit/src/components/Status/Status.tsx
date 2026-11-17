import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import { QUEUED_GLYPH, STATUS_GLYPHS, type StatusRole } from './roles';
import styles from './Status.module.css';

export type { StatusRole } from './roles';

type StatusWord = {
  /** The platform's own word for the state, in its own spelling ("Running", "Shutting down"). It names the state: the glyph never does. */
  readonly children: string;
} & DataAttributes;

type StaticRole = { readonly role: Exclude<StatusRole, 'progress'>; readonly queued?: undefined };
type ProgressRole = {
  readonly role: 'progress';
  /** Work that waits to start is drawn with the clock; work under way with the loader (design 13 SR1). */
  readonly queued?: boolean | undefined;
};

export type StatusProps = StatusWord & (StaticRole | ProgressRole);

// A bare boolean is a plain word, never a state (design 13 SR2).
const BOOLEAN_WORD = /^(?:yes|no|true|false)$/i;

/**
 * A state: the glyph of its role and the platform's word, side by side and on one line, so a state is never colour alone (design 13
 * S1, SR1). The role is from the closed table of seven; it fixes the glyph and the word keeps its spelling. A bare boolean is not a
 * state: it prints as plain words with no glyph (SR2). Props are closed: no `className`, no `style`, no icon of the caller's;
 * `data-*` passes through.
 */
export function Status({ role, children, queued, ...rest }: StatusProps) {
  if (BOOLEAN_WORD.test(children.trim())) {
    return children;
  }

  return (
    <span {...dataAttributes(rest)} className={styles.root} data-ov-role={role}>
      <Icon name={queued === true ? QUEUED_GLYPH : STATUS_GLYPHS[role]} />
      {children}
    </span>
  );
}
