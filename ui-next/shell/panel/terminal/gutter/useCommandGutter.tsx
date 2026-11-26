import type { ReactNode } from 'react';
import type { ScreenCommands } from '../screen';

// SCAFFOLD (issue #694 step 5): the hover of a command's mark and what the gutter says, which the next commit fills in.

export type CommandGutterScreen = { readonly commands: Pick<ScreenCommands, 'onEvent'> };

export type CommandGutterOptions = {
  readonly screen: CommandGutterScreen | undefined;
  /** Says words to a person who cannot see the view move: the body's polite live region. */
  readonly say: (words: string) => void;
};

export type CommandGutterView = {
  /** The tooltip of the mark the pointer is on, and nothing while it is on none. */
  readonly element: ReactNode;
};

export function useCommandGutter(_options: CommandGutterOptions): CommandGutterView {
  return { element: null };
}
