import { useId, useState } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { MiddleEllipsis } from '../MiddleEllipsis';
import styles from './TagList.module.css';

export type TagItem = { readonly key: string; readonly value?: string | undefined };

export type TagListProps = {
  /** Names the group ("Labels"). */
  readonly label: string;
  readonly items: readonly TagItem[];
  /** The first this many show; the rest are behind "Show all N". Default 6. */
  readonly visible?: number | undefined;
  /** The set starts open. */
  readonly defaultExpanded?: boolean | undefined;
} & DataAttributes;

const DEFAULT_VISIBLE = 6;
/** A key of this many characters or fewer is drawn whole; a longer one is drawn in two halves that keep its end. */
const SPLIT_KEY_FROM = 12;
/** A key longer than this would fill a 342 px column by itself: its value is a chip of its own. */
const LONG_KEY = 38;
/** The most characters of a value on screen, and in the tip. */
const SHOWN_VALUE = 400;
const TIPPED_VALUE = 600;

/** The text cut to `size` characters, the last of them an ellipsis. Characters, not code units: a pair is never split. */
function wholeText(text: string, size: number): string {
  const characters = Array.from(text);
  return characters.length > size ? `${characters.slice(0, size - 1).join('')}…` : text;
}

/**
 * A key's face: short, whole; long, in two halves, the start giving way and the end staying (`MiddleEllipsis`). How much stays is the
 * mock's rule: after the last slash when there is one (`example.io/…managed-by`), a third of the name when there is not, from 6
 * to 28 characters and never the whole name.
 */
function keyFace(key: string) {
  const characters = Array.from(key);
  if (characters.length <= SPLIT_KEY_FROM) {
    return key;
  }

  const slash = characters.lastIndexOf('/');
  const tail = Math.min(characters.length - 1, 28, Math.max(6, slash < 0 ? Math.floor(characters.length / 3) : characters.length - slash - 1));
  return <MiddleEllipsis tail={tail}>{key}</MiddleEllipsis>;
}

function Tag({ item }: { readonly item: TagItem }) {
  const { key, value } = item;
  const tip = value === undefined || value === '' ? key : `${key} = ${wholeText(value, TIPPED_VALUE)}`;
  if (value === undefined) {
    return (
      <span className={styles.tag} data-ov-part="tag" data-ov-tip={tip}>
        <span className={styles.key} data-ov-part="tag-key" data-ov-lone="true">
          {keyFace(key)}
        </span>
      </span>
    );
  }

  const shown = wholeText(value.replace(/\s+/g, ' ').trim(), SHOWN_VALUE);
  if (Array.from(key).length > LONG_KEY) {
    return (
      <>
        <span className={styles.tag} data-ov-part="tag" data-ov-tip={tip}>
          <span className={styles.key} data-ov-part="tag-key">
            {keyFace(key)}
          </span>
        </span>
        <span className={styles.tag} data-ov-part="tag" data-ov-tip={tip}>
          <span className={styles.value} data-ov-part="tag-value">
            {shown}
          </span>
        </span>
      </>
    );
  }

  return (
    <span className={styles.tag} data-ov-part="tag" data-ov-tip={tip}>
      <span className={styles.key} data-ov-part="tag-key">
        {keyFace(key)}
      </span>
      <span className={styles.value} data-ov-part="tag-value">
        {shown}
      </span>
    </span>
  );
}

/**
 * A group of tags: a key and its value as one chip, wrapping in rows, 8 px apart (the mock's Labels and Annotations). A chip gives way
 * in a fixed order: the value clamps first (one line, an ellipsis), the key keeps its end (`MiddleEllipsis`), and a key of more than 38
 * characters gets its value as a chip of its own beside it, or under it when the line is full. A tag with no value shows its key alone. The
 * whole pair is in the tip. More than `visible` items fold behind a native "Show all N" button, which says whether the rest is shown
 * (`aria-expanded`) and reads "Show fewer" once open; the state is the part's own, `defaultExpanded` seeds it. The group is a
 * `role="group"` named by `label`; a chip is text, not a control. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function TagList({ label, items, visible, defaultExpanded, ...rest }: TagListProps) {
  const [open, setOpen] = useState(defaultExpanded === true);
  const chipsId = useId();
  if (items.length === 0) {
    return null;
  }

  const limit = visible !== undefined && Number.isFinite(visible) ? Math.max(0, Math.floor(visible)) : DEFAULT_VISIBLE;
  const folds = items.length > limit;
  const shown = folds && !open ? items.slice(0, limit) : items;

  return (
    <div {...dataAttributes(rest)} className={styles.root} role="group" aria-label={label} data-ov-part="tag-list">
      {shown.length === 0 ? null : (
        <div id={chipsId} className={styles.chips}>
          {shown.map((item, index) => (
            <Tag key={`${String(index)}:${item.key}`} item={item} />
          ))}
        </div>
      )}
      {folds ? (
        <div>
          <button
            type="button"
            className={styles.toggle}
            data-ov-part="toggle"
            aria-expanded={open}
            aria-controls={shown.length === 0 ? undefined : chipsId}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? 'Show fewer' : `Show all ${String(items.length)}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
