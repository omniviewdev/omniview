import type { StatusRole } from '@omniviewdev/kit';
import { UNLOADED_CAUSE, type Route, type Session, type SessionState } from '../core/panel';
import type { PanelCard } from './host';

// What the card of a session says, once the host has completed the plugin's description with its own defaults and cut it to the rules (ch16 SCD1; the mock's `cardFor`, shell-panel.js). Pure:
// the card's component draws the answer.

/** The buttons a card shows, `Open <resource>` included. */
export const MAX_ACTIONS = 2;

const STATE_WORDS: Readonly<Record<SessionState, string>> = { starting: 'Starting', running: 'Running', ended: 'Ended', failed: 'Failed' };
const STATE_ROLES: Readonly<Record<SessionState, StatusRole>> = { starting: 'progress', running: 'running', ended: 'stopped', failed: 'error' };

export type CardAction = {
  readonly label: string;
  readonly icon: string | undefined;
  readonly onSelect: () => void;
  readonly disabledReason: string | undefined;
  /** The button opens the resource: the card draws it first, and the host opens it through the tab model. */
  readonly opens: boolean;
};

export type ResolvedCard = {
  readonly kind: string;
  readonly icon: string;
  readonly resource:
    | {
      readonly label: string;
      readonly kind: string;
      readonly icon: string | undefined;
      readonly route: Route | undefined;
      /** Why the link back to the resource cannot open now: its plugin is off (A21). Absent while it can, and for a resource that has no route, which is no link. */
      readonly disabledReason: string | undefined;
    }
    | undefined;
  readonly facts: ReadonlyArray<readonly [label: string, text: string]>;
  readonly state: { readonly label: string; readonly role: StatusRole; readonly since: string; readonly reason: string };
  readonly actions: readonly CardAction[];
};


const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const sentence = (value: string): string => (value === '' || /[.!?…]$/.test(value) ? value : `${value}.`);
const pad = (n: number): string => String(n).padStart(2, '0');

/** "08:41" for a time today, "yesterday 08:41", else "Nov 14 08:41"; nothing for a time that is not one (the mock's `sinceWords`). */
export function sinceWords(ms: number, now: number): string {
  if (!(ms > 0)) {
    return '';
  }

  const date = new Date(ms);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const behind = Math.round((day(new Date(now)) - day(date)) / 86_400_000);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (behind <= 0) {
    return clock;
  }

  return behind === 1 ? `yesterday ${clock}` : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/**
 * The card of a session: the plugin's description (`given`), member by member over the host's defaults. The kind and the glyph default to the tool's; the state's words and role to the
 * session's; a session that belongs to a resource shows it as a link (its title, when the plugin names none) with Open <resource> as the first button; the reason is the plugin's, else the
 * session's own cause, for a session that is not running. At most two buttons show in all. `pluginOff` says the session's plugin is off (only a session of a tool of the host, kept across the unload, A21, can be
 * listed then): the way back to the resource, its link and the Open button, cannot work, and the reason is always the unload's sentence, which the card prints after what the session says of itself.
 */
export function cardOf(session: Session, tool: { readonly label: string; readonly icon: string }, given: PanelCard | undefined, now: number, pluginOff = false): ResolvedCard {
  const named = given?.resource;
  const route = named === undefined ? session.route : named.route;
  const label = text(named?.label) || (named === undefined && session.route !== undefined ? session.title : '');
  const settled = session.state === 'ended' || session.state === 'failed';
  const told = sentence(text(given?.state?.reason) || (settled ? text(session.cause) : ''));
  // A21: the sessions of a tool of the host are kept while their plugin is off, and the way back to their resource is a page of that plugin. It cannot open, for the unload's sentence: it is printed on the card (it
  // is the session's own cause when the unload ended it, and it comes after the stream's own words when the session had ended or failed on its own) and it is the button's reason, which a pressable button
  // with no reason would lack.
  const reason = pluginOff && !told.includes(UNLOADED_CAUSE) ? [told, UNLOADED_CAUSE].filter((part) => part !== '').join(' ') : told;
  const blocked = pluginOff ? UNLOADED_CAUSE : undefined;
  const resource = label === '' ? undefined : { label, kind: text(named?.kind), icon: named?.icon, route, disabledReason: route === undefined ? undefined : blocked };
  const own: CardAction[] = (given?.actions ?? [])
    .filter((action) => text(action.label) !== '')
    .map((action) => ({ label: text(action.label), icon: action.icon, onSelect: action.onSelect, disabledReason: text(action.disabledReason) || undefined, opens: false }));
  const open: CardAction[] =
    resource?.route === undefined ? [] : [{ label: `Open ${resource.kind === '' ? 'resource' : resource.kind}`, icon: undefined, onSelect: () => undefined, disabledReason: blocked, opens: true }];
  return {
    kind: text(given?.kind) || tool.label,
    icon: text(given?.icon) || tool.icon,
    resource,
    facts: (given?.facts ?? []).filter(([name, value]) => text(name) !== '' && text(value) !== '').map(([name, value]) => [text(name), text(value)] as const),
    state: {
      label: text(given?.state?.label) || STATE_WORDS[session.state],
      role: STATE_ROLES[session.state],
      since: sinceWords(session.since, now),
      reason,
    },
    actions: [...open, ...own].slice(0, MAX_ACTIONS),
  };
}
