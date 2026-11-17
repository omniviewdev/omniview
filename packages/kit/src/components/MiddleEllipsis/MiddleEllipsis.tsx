import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './MiddleEllipsis.module.css';

/** A name of this many characters or more is drawn in two halves; a shorter one is cut at its end, if at all (the mock's rule). */
const SPLIT_FROM = 13;
const MIN_TAIL = 6;
const MAX_TAIL = 12;

export type MiddleEllipsisProps = {
  /** The name. Whatever is cut on screen, it reads once and whole. */
  readonly children: string;
  /** How many trailing characters stay whole when the name is cut: the part that tells siblings apart (`-7x5nx`). Without it a third of the name stays, from 6 to 12 characters. */
  readonly tail?: number | undefined;
} & DataAttributes;

/**
 * A name that keeps its distinguishing end when it is cut (design 13 COL4, T5): the start gives way with an ellipsis and the tail stays
 * whole. CSS decides where the cut falls, so nothing is measured and no listener is added. The root is the clipping box and carries
 * the signal for the shared tip host: the marker `data-ov-clip`, and in two halves `data-ov-full`, the whole name; the host shows the
 * full name only while the root is cut (its scroll width exceeds its width). It is a block-level box: in a block container it fills the
 * width, in a flex row it takes the width of its name up to the space it is given; its type is the context's. Props are closed: no
 * `className`, no `style`, no `title`; `data-*` passes through.
 *
 * The name is announced and copied once, whole. The two halves are boxes of a flex row, which assistive technology reads as two words
 * (`alertmanager-5d5bcf5596 -qxv45`) and a selection copies with a line break between, so they hold no text: each is hidden from assistive
 * technology and draws its half from an attribute in the stylesheet, and the name is real text in one element of its own that takes no room.
 */
export function MiddleEllipsis({ children, tail, ...rest }: MiddleEllipsisProps) {
  // Characters, not code units: a pair is never split.
  const characters = Array.from(children);
  if (characters.length < SPLIT_FROM) {
    return (
      <span {...dataAttributes(rest)} className={styles.root} data-ov-shape="plain" data-ov-clip="">
        {children}
      </span>
    );
  }

  const wanted = tail !== undefined && Number.isInteger(tail) && tail > 0 ? tail : Math.min(MAX_TAIL, Math.max(MIN_TAIL, Math.floor(characters.length / 3)));
  const keep = Math.min(characters.length - 1, wanted);

  return (
    <span {...dataAttributes(rest)} className={styles.root} data-ov-shape="split" data-ov-clip="" data-ov-full={children}>
      <span aria-hidden="true" className={styles.head} data-ov-text={characters.slice(0, -keep).join('')} />
      <span aria-hidden="true" className={styles.tail} data-ov-text={characters.slice(-keep).join('')} />
      <span className={styles.name}>{children}</span>
    </span>
  );
}
