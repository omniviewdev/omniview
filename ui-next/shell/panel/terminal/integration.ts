import type { TerminalFeedSnapshot } from './feed';

// The quality tier of a terminal's shell integration (issue #694 step 6), derived on the page from two facts the producer states and never guessed: the host's word on the integration (`integration`) and whether the shell has proved
// itself with its nonce (`proven`: a command line or a directory came with it). Definitions are in docs/ui-next/status/T5-notice.md.

export type IntegrationTier = 'none' | 'basic' | 'rich';

/** What the card and the screen reader say of the integration of a terminal. */
export type IntegrationWords = { readonly tier: IntegrationTier; readonly label: string; readonly text: string };

/** The tier of a terminal. */
export function tierOf(_status: Pick<TerminalFeedSnapshot, 'integration' | 'proven'>): IntegrationTier {
  return 'none';
}

/** The words of the tier, or `undefined` when the producer says nothing of the integration (a fact not told is not on the card). */
export function integrationWords(_status: Pick<TerminalFeedSnapshot, 'integration' | 'proven'>): IntegrationWords | undefined {
  return undefined;
}
