import { isPlainObject, strictJson } from '../tabs/json';
import { normaliseRoute } from '../tabs/route';
import { line } from './text';
import { LIMITS, type ActionCall, type ActionInput, type ActionKind, type ActionView, type Availability, type Cancellation, type CommandRef, type Json, type Route, type State, type Target } from './types';

// The actions of a record (S74, S84, RC1). A producer writes up to four; each acts by DATA (a route the tab model opens, a command id with plain arguments) or by the producer's own code,
// which is kept in memory and never in the snapshot. The model adds Cancel when the producer can cancel. The order, the variant and the reason a command cannot be used are decided here,
// once, for every surface (the mock's `normActions` and `resolveActions`, X1): a function that cannot run stays visible and says why, and never stands as a dead button.

/** An action as the model holds it: data only. The code of a `run` is the store's, by id. */
export type ActionDecl = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly label: string;
  readonly route: Route | undefined;
  readonly reveal: Json | undefined;
  readonly command: CommandRef | undefined;
  /** The producer gave code for it (kept in the store, by id). */
  readonly code: boolean;
  readonly primary: boolean;
  readonly danger: boolean;
  readonly icon: string;
  /** Why it cannot be used now, as the producer says; empty when it can. */
  readonly disabled: string;
  /** An action the model itself provides: Mute, on the row of a source that posts too much. It needs no code and no plugin. */
  readonly builtin: 'mute' | undefined;
};

export type Declared = {
  readonly decls: readonly ActionDecl[];
  /** The code of the actions that have some, by id. */
  readonly runs: ReadonlyMap<string, (call: ActionCall) => unknown>;
  /** What was refused, and why: the caller tells whoever wrote it. */
  readonly problems: readonly string[];
};

const KINDS: readonly ActionKind[] = ['cancel', 'retry', 'open', 'custom'];
const DEFAULT_LABEL: Readonly<Record<ActionKind, string>> = { cancel: 'Cancel', retry: 'Retry', open: 'Open', custom: '' };
const RESTART = 'Not available after restart';
const REQUESTED = 'Requested. Waiting for the producer to acknowledge. Effects are not undone.';
const ACKNOWLEDGED = 'Acknowledged. Waiting for the producer to finish stopping. Effects are not undone.';

const isKind = (value: unknown): value is ActionKind => typeof value === 'string' && (KINDS as readonly string[]).includes(value);
const isStop = (label: string): boolean => /^Stop(?:\s|$)/.test(label);

/** A command as data: a registry id of at most 128 characters and plain arguments; `undefined` for anything else. */
export function commandOf(value: unknown): CommandRef | undefined {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id.trim() === '' || value.id.length > 128) {
    return undefined;
  }

  const arg = value.arg === undefined ? undefined : strictJson(value.arg);
  const target = value.target === undefined ? undefined : strictJson(value.target);
  if ((value.arg !== undefined && arg === undefined) || (value.target !== undefined && target === undefined)) {
    return undefined;
  }

  return Object.freeze({ id: value.id.trim(), ...(arg === undefined ? {} : { arg }), ...(target === undefined ? {} : { target }) });
}

/**
 * What a producer wrote, as data: at most four, an id and a label each, one way to act each (a route, a command, or code), the first Open the Open. An action that has no way to act, or
 * has two, or names a route or a command that is not valid data, is refused with its reason: a button must do the one thing it says. A Retry may rest on the handle's `onRetry`, and a Cancel
 * only relabels the one the model adds.
 */
export function declareActions(list: unknown): Declared {
  const decls: ActionDecl[] = [];
  const runs = new Map<string, (call: ActionCall) => unknown>();
  const problems: string[] = [];
  if (!Array.isArray(list)) {
    return { decls, runs, problems };
  }

  const seen = new Set<string>();
  let opened = false;
  for (const entry of list as readonly unknown[]) {
    if (decls.length >= LIMITS.actions) {
      break;
    }

    if (!isPlainObject(entry)) {
      problems.push('an action is not an object');
      continue;
    }

    const input = entry as ActionInput;
    const hasRoute = input.route !== undefined;
    const hasCommand = input.command !== undefined;
    const hasRun = typeof input.run === 'function';
    const requested = isKind(input.kind) ? input.kind : isKind(input.id) ? input.id : hasRoute ? 'open' : 'custom';
    const id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim().slice(0, LIMITS.key) : requested === 'custom' ? `action-${String(decls.length)}` : requested;
    if (seen.has(id)) {
      continue;
    }

    const ways = Number(hasRoute) + Number(hasCommand) + Number(hasRun);
    if (ways > 1) {
      problems.push(`action "${id}" has more than one way to act: give a route, a command or code`);
      continue;
    }

    if (ways === 0 && requested !== 'retry' && requested !== 'cancel') {
      problems.push(`action "${id}" has no way to act: give a route, a command or code`);
      continue;
    }

    if ((requested === 'retry' || requested === 'cancel') && (hasRoute || hasCommand)) {
      problems.push(`action "${id}" is a ${requested}: it acts through code, not a route or a command`);
      continue;
    }

    const route = hasRoute ? normaliseRoute(input.route) : undefined;
    const command = hasCommand ? commandOf(input.command) : undefined;
    if ((hasRoute && route === undefined) || (hasCommand && command === undefined)) {
      problems.push(`action "${id}" names a ${hasRoute ? 'route' : 'command'} that is not valid data`);
      continue;
    }

    const reveal = route !== undefined && input.reveal !== undefined ? strictJson(input.reveal) : undefined;
    const kind: ActionKind = requested === 'open' && opened ? 'custom' : requested;
    opened ||= kind === 'open';
    seen.add(id);
    const label = line(input.label, LIMITS.actionLabel);
    const disabled = input.disabled === true ? 'Not available' : typeof input.disabled === 'string' ? line(input.disabled, 80) : '';
    decls.push(Object.freeze({
      id,
      kind,
      label: label === '' ? (DEFAULT_LABEL[kind] === '' ? id : DEFAULT_LABEL[kind]) : label,
      route,
      reveal,
      command,
      code: hasRun,
      primary: input.primary === true,
      danger: input.danger === true,
      icon: line(input.icon, 64),
      disabled,
      builtin: undefined,
    }));
    if (hasRun && input.run !== undefined) {
      runs.set(id, input.run);
    }
  }

  return { decls, runs, problems };
}

/** What the model knows when it resolves a record's actions. */
export type ResolveInput = {
  readonly state: State;
  readonly cancellation: Cancellation;
  readonly target: Target | undefined;
  readonly decls: readonly ActionDecl[];
  /** Which callbacks of the producer exist now: its cancel, its retry (the handle's or a declared one's), and the code of a custom action by id. */
  readonly handlers: { readonly cancel: boolean; readonly retry: boolean; readonly has: (id: string) => boolean };
  /** Why the producer's code cannot run, when its plugin left ("Cloud isn't running."); empty while it can. */
  readonly dead: string;
  readonly availability: (route: Route) => Availability;
  readonly commandAvailability: (command: CommandRef) => Availability;
  /** Whether a route is the page the user is on: a call to action never opens the current page (OF3). */
  readonly current: (route: Route) => boolean;
  /** A message has no state to fail, but a Retry its producer declared is offered, first, like the Retry of a failure (RC1: every error has a way forward). */
  readonly kind?: 'message' | 'operation' | undefined;
};

type Draft = Pick<ActionView, 'id' | 'kind' | 'label' | 'icon' | 'danger' | 'disabled' | 'route' | 'command'> & { readonly primary: boolean };

const unavailable = (answer: Availability): string => (answer.state === 'unavailable' ? (answer.reason === '' ? 'Not available' : answer.reason) : '');

/**
 * The actions a record shows, in priority order, each with the reason it cannot be used. Active: Cancel (only when the producer reports it can, S84), the producer's own, then Open; a
 * paused record leads with the producer's (Resume). Failed: Retry, the producer's, Open. Unknown: the producer's primary recovery, Open, Retry, the rest (S84a). Any other: the producer's,
 * Open, Retry. The variant (primary only for a first Retry or one that says so) and the verb of the command are decided here.
 */
export function resolveActions(input: ResolveInput): readonly ActionView[] {
  const { state, cancellation, target, decls, handlers } = input;
  const active = state === 'queued' || state === 'running' || state === 'paused';
  const find = (kind: ActionKind): ActionDecl | undefined => decls.find((decl) => decl.kind === kind);

  const draft = (decl: Pick<ActionDecl, 'id' | 'kind' | 'label' | 'icon' | 'danger' | 'primary'>, extra: Partial<Draft> = {}): Draft => ({
    id: decl.id,
    kind: decl.kind,
    label: decl.label,
    icon: decl.icon,
    danger: decl.danger,
    primary: decl.primary,
    disabled: '',
    route: undefined,
    command: undefined,
    ...extra,
  });

  /** Why the producer's own code cannot run: it did not survive a restart, or its plugin left. */
  const codeReason = (has: boolean): string => (input.dead === '' ? (has ? '' : RESTART) : input.dead);

  const cancel = (): Draft[] => {
    if (!active || cancellation === 'unsupported') {
      return [];
    }

    const decl = find('cancel');
    const stop = isStop(decl?.label ?? '');
    if (cancellation === 'requested' || cancellation === 'acknowledged') {
      return [draft({ id: 'cancel', kind: 'cancel', label: stop ? 'Stopping…' : 'Canceling…', icon: decl?.icon ?? '', danger: false, primary: false }, { disabled: cancellation === 'acknowledged' ? ACKNOWLEDGED : REQUESTED })];
    }

    const declared = decl?.disabled ?? '';
    return [draft({ id: 'cancel', kind: 'cancel', label: decl?.label ?? 'Cancel', icon: decl?.icon ?? '', danger: decl?.danger ?? false, primary: false }, { disabled: declared === '' ? codeReason(handlers.cancel) : declared })];
  };

  const retry = (): Draft[] => {
    if (active || (input.kind !== 'message' && state !== 'failed' && state !== 'unknown' && state !== 'cancelled')) {
      return [];
    }

    const decl = find('retry');
    if (decl === undefined && !handlers.retry) {
      return [];
    }

    const declared = decl?.disabled ?? '';
    return [draft(decl ?? { id: 'retry', kind: 'retry', label: 'Retry', icon: '', danger: false, primary: false }, { disabled: declared === '' ? codeReason(handlers.retry) : declared })];
  };

  /** "Open {label}" names the thing (X3); a label of its own ("Open logs") is kept; with no name it is "Open details". */
  const open = (): Draft[] => {
    const decl = find('open');
    const route = decl?.route ?? target?.route;
    if (route === undefined || target?.removed === true || input.current(route)) {
      return [];
    }

    const own = decl !== undefined && !/^Open( target)?$/.test(decl.label);
    const label = decl !== undefined && own ? decl.label : target === undefined ? 'Open details' : line(`Open ${target.label}`, 32);
    const declared = decl?.disabled ?? '';
    return [draft(decl ?? { id: 'open', kind: 'open', label, icon: '', danger: false, primary: false }, { label, route, disabled: declared === '' ? unavailable(input.availability(route)) : declared })];
  };

  const custom = (): Draft[] => decls.filter((decl) => decl.kind === 'custom').map((decl) => {
    if (decl.disabled !== '') {
      return draft(decl, { disabled: decl.disabled, route: decl.route, command: decl.command });
    }

    let disabled = '';
    if (decl.builtin !== undefined) {
      disabled = '';
    } else if (decl.route !== undefined) {
      disabled = unavailable(input.availability(decl.route));
    } else if (decl.command !== undefined) {
      disabled = unavailable(input.commandAvailability(decl.command));
    } else {
      disabled = codeReason(handlers.has(decl.id));
    }

    return draft(decl, { disabled, route: decl.route, command: decl.command });
  });

  const recovery = (): Draft[] => custom().filter((action) => action.primary);
  const remaining = (): Draft[] => custom().filter((action) => !action.primary);

  const order: ReadonlyArray<() => Draft[]> = active
    ? (state === 'paused' ? [custom, cancel, open] : [cancel, custom, open])
    : state === 'failed' || (input.kind === 'message' && find('retry') !== undefined)
      ? [retry, custom, open]
      : state === 'unknown'
        ? [recovery, open, retry, remaining]
        : [custom, open, retry];

  return Object.freeze(order.flatMap((part) => part()).map(({ primary, ...rest }, index): ActionView => Object.freeze({ ...rest, variant: index === 0 && (rest.kind === 'retry' || primary) ? 'primary' : 'default' })));
}
