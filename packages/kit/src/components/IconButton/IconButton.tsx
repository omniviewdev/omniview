import type { MouseEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { useCommand } from '../../shared/useCommand';
import styles from '../../shared/command.module.css';
import type { ButtonTone, ButtonVariant } from '../Button';
import { Icon, type IconName } from '../Icon';

/** `standard` is a 28 px square; `row` the row target, 24 px (22 in compact density), for a command inside a table row or a dense lane. */
export type IconButtonSize = 'standard' | 'row';

export type IconButtonProps = {
  readonly icon: IconName;
  /** Its accessible name. Required: it is never taken from the glyph or from an action (design 15 C8, 14 P4). */
  readonly label: string;
  readonly variant?: ButtonVariant | undefined;
  readonly tone?: ButtonTone | undefined;
  readonly size?: IconButtonSize | undefined;
  /** The command's own request is in flight: `aria-busy` at once; after a second the glyph becomes the loader. Input is not blocked. */
  readonly busy?: boolean | undefined;
  /** Makes the button a toggle: `aria-pressed`, and the quiet pressed fill when `true`. The caller owns the state and flips it in `onClick`; the label stays one fixed name. Absent, the button is a plain command and has no `aria-pressed` at all. */
  readonly pressed?: boolean | undefined;
  /** Why the command is unavailable. The button stays focusable with `aria-disabled`, does nothing, and has this as its description. Print the same reason where the user reads the page (design 14 P2, 04 DR1). */
  readonly disabledReason?: string | undefined;
  /** The button opens a menu: `aria-haspopup="menu"`. Whether the menu is open is the menu's to say (`RowMenu`'s handle writes `aria-expanded` and `aria-controls` on the trigger that is open). */
  readonly popup?: 'menu' | undefined;
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
} & DataAttributes;

/**
 * A command with a glyph and no visible text, in a native button whose name is its `label`. Props are closed: no `className`, no
 * `style`; `data-*` passes through. It is never natively disabled and never submits a form.
 */
export function IconButton({ icon, label, variant = 'secondary', tone = 'neutral', size = 'standard', busy, pressed, disabledReason, popup, onClick, ...rest }: IconButtonProps) {
  const command = useCommand({ busy, disabledReason, onClick });
  return (
    <button
      {...dataAttributes(rest)}
      type="button"
      className={styles.root}
      data-ov-shape="icon"
      data-ov-variant={variant}
      data-ov-tone={tone}
      data-ov-size={size}
      aria-label={label}
      aria-disabled={command.reason === undefined ? undefined : 'true'}
      aria-pressed={pressed}
      aria-haspopup={popup}
      aria-busy={busy === true ? 'true' : undefined}
      aria-describedby={command.reason === undefined ? undefined : command.reasonId}
      onClick={command.onClick}
    >
      <Icon name={command.loader ? 'loader' : icon} data-ov-busy={command.loader ? 'true' : undefined} />
      {command.reason === undefined ? null : (
        <span id={command.reasonId} hidden>
          {command.reason}
        </span>
      )}
    </button>
  );
}
