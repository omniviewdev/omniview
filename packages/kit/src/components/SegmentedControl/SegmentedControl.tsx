import { useId, type KeyboardEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import { tip } from '../TooltipHost';
import styles from './SegmentedControl.module.css';

type OptionBase<Value extends string> = {
  /** What the control's value is when this option is chosen. Also its key. */
  readonly value: Value;
  /** A 16 px glyph before the label. Decorative: the label, or the tip of an icon-only option, is the name. */
  readonly icon?: IconName | undefined;
  /** Why the option cannot be chosen. It stays in the group and reachable by the pointer's tooltip, is `aria-disabled`, and the arrows skip it. */
  readonly disabledReason?: string | undefined;
};

/** A text option, with an optional glyph. */
type TextOption<Value extends string> = OptionBase<Value> & { readonly label: string; readonly tip?: string | undefined };
/** An icon-only option: it has no label, so its tip is its accessible name. */
type IconOption<Value extends string> = OptionBase<Value> & { readonly label?: undefined; readonly icon: IconName; readonly tip: string };

export type SegmentedOption<Value extends string = string> = TextOption<Value> | IconOption<Value>;

export type SegmentedControlProps<Value extends string = string> = {
  /** The radiogroup's accessible name: what the choice is about ("View as"). */
  readonly label: string;
  readonly options: ReadonlyArray<SegmentedOption<Value>>;
  /** The chosen option's value. The caller owns it. */
  readonly value: Value;
  /** Called with the option's value when the user chooses another option, by the pointer or by the arrows. */
  readonly onValueChange: (value: Value) => void;
} & DataAttributes;

const available = (option: SegmentedOption) => option.disabledReason === undefined || option.disabledReason.trim() === '';

/**
 * One choice out of a few, as a row of joined buttons: a radiogroup of native buttons with the radio role. It is one Tab stop (the
 * chosen option, else the first one that can be chosen); the arrows of the row move to the neighbour and choose it, Home and End go
 * to the ends, and an option that is unavailable for a reason is skipped. It never wraps; when it does not fit it scrolls sideways.
 * Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function SegmentedControl<Value extends string>({ label, options, value, onValueChange, ...rest }: SegmentedControlProps<Value>) {
  const base = useId();
  const chosen = options.findIndex((option) => option.value === value && available(option));
  const stop = chosen >= 0 ? chosen : options.findIndex(available);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key that something else took, a composition, and a chord are not the group's.
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') {
      return;
    }

    const faces = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = faces.indexOf(event.target as HTMLElement);
    if (at < 0) {
      return;
    }

    event.preventDefault();
    const reachable = options.flatMap((option, index) => (available(option) ? [index] : []));
    const position = reachable.indexOf(at);
    const to =
      key === 'Home'
        ? reachable[0]
        : key === 'End'
          ? reachable[reachable.length - 1]
          : key === 'ArrowLeft' || key === 'ArrowUp'
            ? reachable[(position + reachable.length - 1) % reachable.length]
            : reachable[(position + 1) % reachable.length];
    const face = to === undefined ? undefined : faces[to];
    const option = to === undefined ? undefined : options[to];
    if (face === undefined || option === undefined || to === at) {
      return;
    }

    face.focus({ preventScroll: true });
    face.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (option.value !== value) {
      onValueChange(option.value);
    }
  };

  return (
    <div {...dataAttributes(rest)} className={styles.root} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const isChosen = option.value === value;
        const reason = available(option) ? undefined : option.disabledReason;
        const reasonId = `${base}-${index}`;
        const text = option.label ?? '';
        return (
          <button
            key={option.value}
            {...dataAttributes(tip(reason ?? option.tip))}
            type="button"
            role="radio"
            className={styles.option}
            aria-checked={isChosen}
            aria-label={text === '' ? option.tip : undefined}
            aria-disabled={reason === undefined ? undefined : 'true'}
            aria-describedby={reason === undefined ? undefined : reasonId}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => {
              if (reason === undefined && !isChosen) {
                onValueChange(option.value);
              }
            }}
          >
            {option.icon === undefined ? null : <Icon name={option.icon} />}
            {text}
            {reason === undefined ? null : (
              <span id={reasonId} hidden>
                {reason}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
