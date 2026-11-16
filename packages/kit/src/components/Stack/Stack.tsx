import type { ReactNode } from 'react';
import type { SpacingStep } from '../../generated/tokenNames';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './Stack.module.css';

export type StackDirection = 'column' | 'row';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between';

export type StackProps = {
  readonly direction?: StackDirection;
  /** Space between children, one step of the closed spacing scale. */
  readonly gap?: SpacingStep;
  /** Space inside the stack on every side, one step of the closed spacing scale. */
  readonly pad?: SpacingStep;
  /** Alignment on the cross axis. */
  readonly align?: StackAlign;
  /** Distribution on the main axis. */
  readonly justify?: StackJustify;
  readonly children?: ReactNode;
} & DataAttributes;

/** A flex container with typed layout props. Props are closed: no `className`, no `style`; `data-*` passes through. */
export function Stack({ direction = 'column', gap, pad, align, justify, children, ...rest }: StackProps) {
  return (
    <div
      {...dataAttributes(rest)}
      className={styles.root}
      data-ov-direction={direction}
      data-ov-gap={gap}
      data-ov-pad={pad}
      data-ov-align={align}
      data-ov-justify={justify}
    >
      {children}
    </div>
  );
}
