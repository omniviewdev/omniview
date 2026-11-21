import type { MouseEvent, ReactNode, Ref } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import commandStyles from '../../shared/command.module.css';
import { useCommand } from '../../shared/useCommand';
import { tip } from '../TooltipHost';

export type FieldButtonProps = {
  /** The button, for a control that moves the focus to it. */
  readonly ref?: Ref<HTMLButtonElement> | undefined;
  /** Its accessible name, which says what it acts on ("Replace API token"): the visible text is the start of it. */
  readonly label: string;
  /** The face: its text, or a glyph. */
  readonly children: ReactNode;
  readonly variant: 'secondary' | 'ghost';
  readonly size: 'compact' | 'row' | 'standard';
  readonly shape?: 'icon' | undefined;
  /** A toggle: `aria-pressed`, under one fixed name. */
  readonly pressed?: boolean | undefined;
  /** Why it cannot act. It stays focusable with `aria-disabled`, does nothing, and has this as its description and its tooltip. */
  readonly disabledReason?: string | undefined;
  /** A button that is a pointer shortcut of a control with one tab stop of its own (a spin button's steps) is not a tab stop. */
  readonly tabStop?: boolean | undefined;
  /** Its tooltip, for a face that is only a glyph. A reason replaces it. */
  readonly tooltip?: string | undefined;
  readonly onPress: () => void;
  /** Called when the pointer goes down on it, after the press has been kept from taking the focus out of the control. */
  readonly onPressStart?: (() => void) | undefined;
} & DataAttributes;

/**
 * A command that belongs to a form control (a step, a show and hide, a replace): the shared face of Button and IconButton on a native
 * button of its own, because these need what those do not give: a name that says which field they act on, and a pointer press that
 * leaves the focus where the field has it, so that looking at a secret or stepping a number never leaves the field (and so never commits it).
 */
export function FieldButton({ ref, label, children, variant, size, shape, pressed, disabledReason, tabStop = true, tooltip, onPress, onPressStart, ...rest }: FieldButtonProps) {
  const command = useCommand({
    busy: undefined,
    disabledReason,
    onClick: () => {
      onPress();
    },
  });
  const tipText = command.reason ?? tooltip;
  return (
    <button
      ref={ref}
      {...dataAttributes(rest)}
      {...dataAttributes(tip(tipText))}
      type="button"
      className={commandStyles.root}
      data-ov-shape={shape}
      data-ov-variant={variant}
      data-ov-tone="neutral"
      data-ov-size={size}
      tabIndex={tabStop ? undefined : -1}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={command.reason === undefined ? undefined : 'true'}
      aria-describedby={command.reason === undefined ? undefined : command.reasonId}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
        // The press must not take the focus from the field: the next key is still the field's, and nothing is committed by leaving it.
        event.preventDefault();
        onPressStart?.();
      }}
      onClick={command.onClick}
    >
      {children}
      {command.reason === undefined ? null : (
        <span id={command.reasonId} hidden>
          {command.reason}
        </span>
      )}
    </button>
  );
}
