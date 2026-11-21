import type { IconName, LogTimestamps, LogViewState } from '@omniviewdev/kit';

// The buttons of the Logs tool's vertical toolbar for the controls the kit's log view has (P1b-4a), as the mock draws them (shell-panel.js 2467-2483 `logsToolbar`, shell-regions.js 298-320 `toolbarHtml`): 28 px
// icon buttons in a 40 px column at the left of the body, in the mock's order, a toggle with one fixed name and its state in `aria-pressed` (ch16 S117), and a button that cannot apply says why. Pure: the
// component draws what this says. What the mock has and this slice does not (Wrap lines, Display options, Jump to time, Filter, Export, the `⋯` that holds what does not fit) is in docs/ui-next/status/P1b-4a.md.

/** The toolbar's accessible name: the tool, then `tools` (the mock's `aria-label="${title} tools"`). */
export const LOG_TOOLS_LABEL = 'Logs tools';

export type LogToolId = 'follow' | 'pause' | 'timestamps' | 'clear' | 'copy';

/** One button: its name (fixed), its glyph, whether it is a toggle and in what state, and why it cannot be pressed now. */
export type LogTool = {
  readonly id: LogToolId;
  readonly label: string;
  readonly icon: IconName;
  /** A toggle says its state; undefined: a plain command, with no `aria-pressed` at all. */
  readonly pressed?: boolean | undefined;
  /** Why the button does nothing now. It stays focusable and says so (the kit's reasoned disable). */
  readonly disabledReason?: string | undefined;
};

export type LogToolsInput = {
  /** What the view says of itself (the kit's `LogViewControls.getSnapshot`). */
  readonly state: LogViewState;
  /** The clock the rows show. */
  readonly timestamps: LogTimestamps;
  /** A copy was just made: the Copy button confirms itself with a check, for two seconds (the mock's `confirmCopy`). */
  readonly copied: boolean;
};

const NO_LINES = 'There are no lines yet';

/** The buttons, in the mock's order. The timestamps toggle stands where the mock's Display options button does: that menu (timestamps, source badges, line numbers, colours, density) is a later slice. */
export function logToolsOf({ state, timestamps, copied }: LogToolsInput): readonly LogTool[] {
  return [
    { id: 'follow', label: 'Follow', icon: 'arrow-down-to-line', pressed: state.following },
    {
      id: 'pause',
      label: 'Pause log updates',
      icon: 'pause',
      pressed: state.paused,
      // The mock disables it for a stream that has ended ('The stream has ended'); one that failed is as over, and a pause on it holds nothing.
      disabledReason: state.feed === 'ended' ? 'The stream has ended' : state.feed === 'failed' ? 'The stream has failed' : undefined,
    },
    { id: 'timestamps', label: 'Show timestamps in UTC', icon: 'globe', pressed: timestamps === 'utc' },
    { id: 'clear', label: 'Clear', icon: 'eraser', disabledReason: state.held ? undefined : NO_LINES },
    { id: 'copy', label: 'Copy', icon: copied ? 'check' : 'copy', disabledReason: state.drawn ? undefined : state.held ? 'No lines match the filters' : NO_LINES },
  ];
}

/**
 * The tooltip of a button: its name, and under it the reason when it cannot apply (the mock's `H.tip({ label, keys, reason })`: the reason is a second muted line). No key hint: the mock gives these four commands
 * no chord (shell-panel.js 2815-2844 binds only Find and Close session in the panel) and its toolbar buttons pass none (shell-regions.js 312).
 */
export const tipOf = (tool: LogTool): string => (tool.disabledReason === undefined ? tool.label : `${tool.label}\n${tool.disabledReason}`);

/** What a person who cannot see the toolbar is told: a copy that was made, and one that was not. */
export type LogAnnouncement = { readonly kind: 'copied'; readonly lines: number; readonly selection: boolean } | { readonly kind: 'copy-failed' };

const plural = (count: number, word: string): string => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** The polite announcement: the mock's `N lines copied` (shell-panel.js 1450), and its failure in the words of its toast (1452), which the host has no toast layer for yet. */
export function announcementOf(announcement: LogAnnouncement): string {
  if (announcement.kind === 'copy-failed') {
    return 'Couldn\'t copy. The clipboard isn\'t available here. Select the lines and copy them with the keyboard.';
  }

  return announcement.selection ? `${plural(announcement.lines, 'selected line')} copied` : `${plural(announcement.lines, 'line')} copied`;
}
