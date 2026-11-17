import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './Text.module.css';

/** The type roles of the closed scale: heading 18/24 600, title 13/16 600, body 13/16 400, caption 12/16 400. */
export type TextVariant = 'heading' | 'title' | 'body' | 'caption';
export type TextTone = 'default' | 'muted';
export type TextElement = 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4';

export type TextProps = {
  /** The element that renders. A heading level is a document-structure choice, never a size: size is `variant`. */
  readonly as?: TextElement;
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
  readonly children?: ReactNode;
} & DataAttributes;

/** Text in one of the closed type roles. Props are closed: no `className`, no `style`; `data-*` passes through. */
export function Text({ as = 'span', variant = 'body', tone = 'default', children, ...rest }: TextProps) {
  const Element = as;
  return (
    <Element {...dataAttributes(rest)} className={styles.root} data-ov-variant={variant} data-ov-tone={tone}>
      {children}
    </Element>
  );
}
