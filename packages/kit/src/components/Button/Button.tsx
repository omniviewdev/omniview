import type { MouseEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useCommand } from '../../shared/useCommand';
import styles from '../../shared/command.module.css';
import { Icon, type IconName } from '../Icon';

/** `primary` is the one filled command of a surface; `secondary` the neutral outlined default; `ghost` the quiet command of a toolbar or lane. */
export type ButtonVariant = 'secondary' | 'primary' | 'ghost';
/** `danger` paints the command in the error role: red text, or with `primary` the solid error control. */
export type ButtonTone = 'neutral' | 'danger';
/** `standard` is 28 px with a roomy side; `compact` the same height with a tight side (toolbars, lanes); `row` the row target, 24 px (22 compact density). */
export type ButtonSize = 'standard' | 'compact' | 'row';

export type ButtonProps = {
  /** The label: a verb in sentence case. It names the button. A face holds no status, count or timer (design 13 M1). */
  readonly children: string;
  readonly variant?: ButtonVariant | undefined;
  readonly tone?: ButtonTone | undefined;
  readonly size?: ButtonSize | undefined;
  /** A 16 px glyph before the label. Decorative: the label is the name. */
  readonly icon?: IconName | undefined;
  /** The command's own request is in flight: `aria-busy` at once; after a second the icon becomes the loader. The label never changes and input is not blocked. */
  readonly busy?: boolean | undefined;
  /** Why the command is unavailable. The button stays focusable with `aria-disabled`, does nothing, and has this as its description. Print the same reason where the user reads the page (design 14 P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
} & DataAttributes;

/**
 * A command in a native button: a label, an optional icon, three variants, a danger tone, three sizes. Props are closed: no
 * `className`, no `style`; `data-*` passes through. It is never natively disabled and never submits a form.
 */
export function Button({ children, variant = 'secondary', tone = 'neutral', size = 'standard', icon, busy, disabledReason, onClick, ...rest }: ButtonProps) {
  const command = useCommand({ busy, disabledReason, onClick });
  return (
    <button
      {...dataAttributes(rest)}
      type="button"
      className={styles.root}
      data-ov-variant={variant}
      data-ov-tone={tone}
      data-ov-size={size}
      aria-disabled={command.reason === undefined ? undefined : 'true'}
      aria-busy={busy === true ? 'true' : undefined}
      aria-describedby={command.reason === undefined ? undefined : command.reasonId}
      onClick={command.onClick}
    >
      {icon === undefined ? null : <Icon name={command.loader ? 'loader' : icon} data-ov-busy={command.loader ? 'true' : undefined} />}
      {children}
      {command.reason === undefined ? null : (
        <span id={command.reasonId} hidden>
          {command.reason}
        </span>
      )}
    </button>
  );
}
