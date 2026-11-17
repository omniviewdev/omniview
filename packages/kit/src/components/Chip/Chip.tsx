import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import styles from './Chip.module.css';

/** The state a chip carries, by the roles of the design: its border, fill and text take the role. A tone is never the only cue: the text names the state. */
export type ChipTone = 'success' | 'warning' | 'error' | 'info' | 'muted';

type ChipContent = {
  /** The chip's text. It names the chip: the name of a toggle, and what a Remove button removes. */
  readonly children: string;
  /** A number after the text, in the plain text colour: a key and its value (`Failed 3`). Zero is a value. */
  readonly count?: number | undefined;
  readonly tone?: ChipTone | undefined;
} & DataAttributes;

type StaticChip = ChipContent & { readonly onClick?: undefined; readonly pressed?: undefined; readonly onRemove?: undefined };
type ToggleChip = ChipContent & {
  /** Makes the chip a native button (28 px). */
  readonly onClick: () => void;
  /** Makes it a toggle: `aria-pressed`, and the pressed fill over its tone. Without it the button is a plain action. */
  readonly pressed?: boolean | undefined;
  readonly onRemove?: undefined;
};
type RemovableChip = ChipContent & {
  /** Adds a 24 px Remove button inside the chip, named `Remove <text>`. The chip is not itself a button, so nothing interactive nests in a non-button. */
  readonly onRemove: () => void;
  readonly onClick?: undefined;
  readonly pressed?: undefined;
};

/** A static chip, a toggle (a button, optionally pressed) or a removable chip: one mode at a time. */
export type ChipProps = StaticChip | ToggleChip | RemovableChip;

/**
 * A small label with an optional count and a tone: static text 18 px high, a toggle button 28 px high, or a chip with a Remove
 * button. Props are closed: no `className`, no `style`; `data-*` passes through. It never wraps, and its text gives way to the
 * line with an ellipsis (the full text is the caller's to tip).
 */
export function Chip({ children, count, tone, onClick, pressed, onRemove, ...rest }: ChipProps) {
  // The text before the count keeps its trailing space, as the mock draws a key and its value.
  const text = count === undefined ? children : `${children} `;
  const value = count === undefined ? null : <b>{count}</b>;

  if (onClick !== undefined) {
    return (
      <button
        {...dataAttributes(rest)}
        type="button"
        className={styles.root}
        data-ov-shape="action"
        data-ov-tone={tone}
        aria-pressed={pressed}
        onClick={() => {
          onClick();
        }}
      >
        <span className={styles.label}>
          {text}
          {value}
        </span>
      </button>
    );
  }

  if (onRemove !== undefined) {
    return (
      <span {...dataAttributes(rest)} className={styles.root} data-ov-shape="removable" data-ov-tone={tone}>
        <span className={styles.label}>
          {text}
          {value}
        </span>
        <button
          type="button"
          className={styles.remove}
          aria-label={`Remove ${count === undefined ? children : `${children} ${count}`}`}
          onClick={() => {
            onRemove();
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </span>
    );
  }

  return (
    <span {...dataAttributes(rest)} className={styles.root} data-ov-shape="static" data-ov-tone={tone} data-ov-counted={count === undefined ? undefined : 'true'}>
      {text}
      {value}
    </span>
  );
}
