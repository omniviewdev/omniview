import { useRef, type ChangeEvent } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Button } from '../Button';
import type { IconName } from '../Icon';

export type FileButtonProps = {
  /** The label: a verb in sentence case ("Import image…"). It names the button. */
  readonly children: string;
  /** The kinds of file the picker offers: MIME types or extensions. It is the picker's filter, not a check: the files that come back are the caller's to validate. */
  readonly accept?: readonly string[] | undefined;
  /** Lets the user pick more than one file. */
  readonly multiple?: boolean | undefined;
  /** A 16 px glyph before the label. */
  readonly icon?: IconName | undefined;
  /** The caller's own work on the files is in flight: `aria-busy`, and the button opens no picker meanwhile. */
  readonly busy?: boolean | undefined;
  /** Why the button is unavailable. It stays focusable with `aria-disabled`, opens no picker, and has this as its description. */
  readonly disabledReason?: string | undefined;
  /** Called with the files the user picked, in the order of the picker; never with none. Reading, decoding and any size limit are the caller's. */
  readonly onFiles: (files: readonly File[]) => void;
} & DataAttributes;

/**
 * A button that opens the system file picker: a `Button` over a hidden file input. It is one Tab stop and reads like any button; the picker
 * opens from its click, whatever made the click. The same file can be picked twice in a row. Props are closed: no `className`, no `style`;
 * `data-*` passes through to the button.
 */
export function FileButton({ children, accept, multiple, icon, busy, disabledReason, onFiles, ...rest }: FileButtonProps) {
  const input = useRef<HTMLInputElement | null>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.currentTarget.files ?? [])];
    // Clearing the value lets the same file be picked again: a picker that sees no change would not report it.
    event.currentTarget.value = '';
    if (files.length > 0) {
      onFiles(files);
    }
  };

  return (
    <>
      <Button
        {...dataAttributes(rest)}
        icon={icon}
        busy={busy}
        disabledReason={disabledReason}
        onClick={() => {
          if (busy !== true) {
            input.current?.click();
          }
        }}
      >
        {children}
      </Button>
      <input ref={input} type="file" hidden tabIndex={-1} accept={accept?.join(',')} multiple={multiple} onChange={onChange} />
    </>
  );
}
