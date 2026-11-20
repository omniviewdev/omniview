import type { LogFeedSource } from '@omniviewdev/kit';
import type { Session } from '../../core/panel';
import { normaliseRoute } from '../../core/tabs';
import type { PanelCard } from '../host';
import type { LogSessionRecord } from './LogStreams';
import { stateWords } from './state';
import { LOGS_TOOL } from './tool';

// What the hover card of a Logs session says (ch16 SCD1; the mock's `cardFor`): the kind, the resource it belongs to as a link, the facts between the resource and the state, and the state in the words
// of a log. The host owns it. What the plugin said when it opened the session (its resource) is in the registry's record; what the feed says now (its sources, that the reader paused it) is read
// when the card is made, so a card is as old as the hover that opened it. The shell completes the description (`../card.ts`): `Open <resource>` is its first button, and the reason of a failure is the
// session's own cause, so this brings no buttons and no reason. Pure.

/** How many sources the card names before it says how many more there are. */
const SOURCES_SHOWN = 3;

/** The sources of a feed as the card words them, by the names the log's rows say (the label the feed gave, else the id): the one, or the first few and how many more. Nothing when the feed lists none. */
function sourcesFact(sources: readonly LogFeedSource[] | undefined): readonly [label: string, text: string] | undefined {
  if (sources === undefined || sources.length === 0) {
    return undefined;
  }

  const names = sources.slice(0, SOURCES_SHOWN).map((source) => (source.label === undefined || source.label === '' ? source.id : source.label));
  const more = sources.length - names.length;
  return [sources.length === 1 ? 'Source' : 'Sources', `${names.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}`];
}

/**
 * The description of the card of `session`, for the registry's `record` of it. A session with no record (one restored from the last run, or whose plugin came back: its stream is gone) has the
 * kind, the glyph and the words of an ended log, and the shell fills in the resource from the session's own route and title.
 */
export function logCardOf(session: Session, record: LogSessionRecord | undefined): PanelCard {
  const { snapshot, resource } = record ?? { snapshot: undefined, resource: undefined };
  const facts: Array<readonly [label: string, text: string]> = [];
  const sources = sourcesFact(snapshot?.sources);
  if (sources !== undefined) {
    facts.push(sources);
  }

  // The reader's pause outlives the end of a feed ("whatever `state` says"), and means nothing once it is over.
  if (snapshot?.paused === true && (session.state === 'starting' || session.state === 'running')) {
    facts.push(['Paused', 'Yes']);
  }

  return {
    kind: 'Logs',
    icon: LOGS_TOOL.icon,
    resource: resource === undefined ? undefined : { label: resource.label, kind: resource.kind, icon: resource.icon, route: resource.route === undefined ? undefined : normaliseRoute(resource.route) },
    facts,
    state: { label: stateWords(session.state, snapshot?.cause) },
  };
}

/**
 * The host's card completed, member by member, by the plugin's (`panel.sessions.logs.card`): what the plugin gives wins, and a member it leaves out stays the host's. The plugin handle writes the members a
 * plugin did not give as own keys holding `undefined`, which a spread would copy over the host's, so they are dropped first.
 */
export function completeLogCard(host: PanelCard, given: PanelCard | undefined): PanelCard {
  if (given === undefined) {
    return host;
  }

  const supplied: Partial<PanelCard> = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined));
  return { ...host, ...supplied };
}
