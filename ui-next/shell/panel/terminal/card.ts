import { normaliseRoute } from '../../core/tabs';
import type { PanelCard } from '../host';
import type { TerminalSessionRecord } from './TerminalSessions';
import { integrationWords } from './integration';
import { stateWords } from './state';
import { TERMINAL_ICON } from './tool';

// What the hover card of a terminal session says (ch16 SCD1; the mock's `cardFor`: its kind is `Shell`, its facts sit between the resource and the state, its state is in the words of a terminal). The host owns it.
// What the supplier said when it opened the session (its resource) is in the registry's record; what the feed says now (what it runs, how it ended) is read when the card is made, so a card is as old as the hover
// that opened it. The shell completes the description (`../card.ts`): `Open <resource>` is its first button, and the reason under the state is the session's own cause (a failure's, and the sentence for a terminal this page
// lost while its shell runs on: `sessionStateOf` words it), so this brings no buttons and no reason.
// A fact the producer does not tell is not on the card, and when it does the card says it with no other code. Pure.

/** The description of the card of a session, from the registry's `record` of it. A session with no record (one restored from the last run: its process is gone) has the kind, the glyph and the words of an ended terminal. */
export function terminalCardOf(record: TerminalSessionRecord | undefined): PanelCard {
  const { snapshot, resource } = record ?? { snapshot: undefined, resource: undefined };
  const facts: Array<readonly [label: string, text: string]> = [];
  if (snapshot?.program !== undefined && snapshot.program.trim() !== '') {
    facts.push(['Shell', snapshot.program.trim()]);
  }

  const integration = snapshot === undefined ? undefined : integrationWords(snapshot);
  if (integration !== undefined) {
    facts.push(['Shell integration', integration.text]);
  }

  return {
    kind: 'Shell',
    icon: TERMINAL_ICON,
    resource: resource === undefined ? undefined : { label: resource.label, kind: resource.kind, icon: resource.icon, route: resource.route === undefined ? undefined : normaliseRoute(resource.route) },
    facts,
    state: { label: stateWords(snapshot) },
  };
}
