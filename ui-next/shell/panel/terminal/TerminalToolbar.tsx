import { IconButton, RovingGroup, tip } from '@omniviewdev/kit';
import type { Platform } from '../../core/chords';
import { chordText } from '../../palette/words';

// The Terminal tool's vertical toolbar (the mock's `.panel__tools`, shell-regions.js 314-320; S117's table: Find, Clear, Copy selection, Paste, Rename session): `role="toolbar" aria-orientation="vertical"` with its name,
// 28 px ghost icon buttons 4 px apart, one Tab stop with the arrows of a column, Home and End. This draws Find, Clear, Copy selection and Rename session (the tab's own name field, #695 step 4). Paste is a later slice (docs/ui-next/status/T1.md):
// Paste is the platform's chord, which the browser delivers through the emulator's paste event with no permission, where a button would have to read the clipboard (the mock's own button says "The clipboard isn't
// readable from here" when the engine refuses). A button that cannot apply stays focusable and says why, in its description and the second line of its tooltip (S117, ch14 P2).

export const TERMINAL_TOOLS_LABEL = 'Terminal tools';
export const NO_SELECTION = 'Select text in the terminal first';
export const NO_TAB = 'The session\'s tab is not on screen';

type TerminalToolbarProps = {
  /** Some of the output is selected: Copy has something to copy. */
  readonly selected: boolean;
  /** A copy was just made: the Copy button confirms itself with a check (the mock's `confirmCopy`). */
  readonly copied: boolean;
  /** The find bar is open: the Find button is pressed, and a press closes it. */
  readonly finding: boolean;
  /** Writes the find chord in the Find button's tip: Command F on a Mac, Control F elsewhere. */
  readonly platform: Platform;
  readonly onFind: () => void;
  readonly onClear: () => void;
  readonly onCopy: () => void;
  /** Starts the rename of this session's tab (the strip draws the field); absent where there is no strip to draw it in. */
  readonly onRename: (() => void) | undefined;
};

export function TerminalToolbar({ selected, copied, finding, platform, onFind, onClear, onCopy, onRename }: TerminalToolbarProps) {
  return (
    <RovingGroup label={TERMINAL_TOOLS_LABEL} kind="column" role="toolbar" gap={4} align="center">
      <IconButton icon="search" label="Find" variant="ghost" pressed={finding} data-terminal-tool="find" {...tip(`Find\n${chordText('Mod+F', platform)}`)} onClick={onFind} />
      <IconButton icon="eraser" label="Clear" variant="ghost" data-terminal-tool="clear" {...tip('Clear')} onClick={onClear} />
      <IconButton
        icon={copied ? 'check' : 'copy'}
        label="Copy selection"
        variant="ghost"
        disabledReason={selected ? undefined : NO_SELECTION}
        data-terminal-tool="copy"
        {...tip(selected ? 'Copy selection' : `Copy selection\n${NO_SELECTION}`)}
        onClick={onCopy}
      />
      <IconButton
        icon="pencil"
        label="Rename session"
        variant="ghost"
        disabledReason={onRename === undefined ? NO_TAB : undefined}
        data-terminal-tool="rename"
        {...tip(onRename === undefined ? `Rename session\n${NO_TAB}` : 'Rename session')}
        onClick={onRename}
      />
    </RovingGroup>
  );
}
