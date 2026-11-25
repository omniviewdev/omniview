import type { NetworkerClient } from '@omniviewdev/runtime/api';
import { ErrorTypes, parseAppError, type AppError } from '@omniviewdev/runtime/ui/v1';
import type { PanelHostV1, PortForwardErrorCodeV1, PortForwardErrorV1, PortForwardRequestV1, PortForwardSessionV1 } from '../contract/v1';
import { safeReason } from './connections/words';
import type { ClosedFeed, ForwardLedger, Place, PluginPresence, Taken } from './portLedger';
import { MAX_DEPTH, weigh, type Overrun } from './portSize';

// What `ctx.panel.ports` is for one page (contract/v1.ts, `PanelHostV1.ports`, PF1 and PF2): a plugin's page names a resource and its ports, and the host starts the forward. The plugin that asks and the connection are not the request's:
// they are the handle's, made for the plugin and for the connection the page is read in (`panelHost.ts`), so a page forwards in its own connection and in no other whatever it writes. The request is the page's words and becomes
// the runtime's typed start (`NetworkerClient.StartResourcePortForwardingSession`) exactly: what the page gave, and the plugin and the connection, and nothing else. The host's networker, the Ports tool, the window's reading of a user
// action, the window's plugins and the count of forwards are given (`PortForwarding`, `portLedger.ts`), so what a forward does is tested with no runtime and no window; `PluginHostScreen.tsx` binds the networker to the runtime and
// `PluginHost.tsx` the rest.
//
// WHAT A CALL IS ASKED, in this order, before the host is asked anything (PF2, S4 of the review of the first slice). (1) THAT A USER ACTION IS UNDER WAY, at the call itself, before anything is read or awaited: a forward starts a listener in
// a plugin's process, so it starts from a click or a key press and never from a render, an effect or a timer. The engine's transient activation lasts about five seconds, which is why this is the first thing the call does and why a page
// that awaits slow work between the click and the call may lose it. An engine that cannot tell (it has no `navigator.userActivation`) is refused as well: the rule is gesture only, so a window that cannot tell a click from a script starts
// no forward. (2) THAT THE REQUEST IS ONE: the shape of the resource and the ports first, which cost nothing, then the bounds on every text, on the body and on the whole (`portSize.ts` walks with a budget and stops at the first excess, so a
// megabyte of text or twenty of body is refused without being serialised or read to its end). (3) THAT THE WINDOW HAS ROOM: a place is taken in the count (`portLedger.ts`), synchronously, for the plugin in the connection and for the window,
// and the call is refused with the cap's number when either is full. A refusal of the three is the host's own `FORBIDDEN`, `INVALID_REQUEST` or `RESOURCE_LIMIT`, in plain words, and the networker is not called.
//
// WHAT THE PAGE IS ANSWERED is the forward as the host's session states it (its id and the port it listens on) and a way to stop it. Where the forward listens is not in it: the session states a port and no address, so the contract's
// `localHost` is there only when a producer states one. The stop closes the session the forward was answered with, through the host, by its id, once, and every call has the one outcome. The host closes by id alone and the SDK gives every
// session a fresh UUID, which is what makes an id one forward's: `PortForwardSessionV1.stop` says what a forwarder that chose ids of its own would leave. The forward is the host's and not the page's (`PanelHostV1.ports` says how long it
// lives), so nothing here ends it but that stop, and the place it holds in the count is given back when it ends.
//
// WHAT THE PAGE IS REFUSED WITH is a `PortForwardError`, and it is a REJECTION: neither call throws into the caller, and a plugin that awaits the answer in a chain of promises hears of a refusal as of any failure. Its code is the
// host's own when the host's answer has one, read by the runtime's one parser (`parseAppError`, decision R13) and never from a text, and its words are the host's own sentence when that is one plain line, else the words of the code's
// class. A sentence that is a dump (a structure, a key and a value: what a refusal looks like when the host's own error was passed on as text) or the runtime's general one is not read out; the error the caller threw is the `cause`.

/** The most forwards a plugin may hold in one connection, counted by the window (those in flight, and those that run until they are stopped). A person can read 64 rows. A plugin's process spends a listener and two descriptors for each connection a forward relays: the review of the first slice measured a plugin that, with a limit of 256 descriptors, ran out at 242 forwards and had none left for its own connections. */
export const MAX_FORWARDS_PER_CONNECTION = 64;

/** The most forwards a window may hold, in all plugins and connections. */
export const MAX_FORWARDS_PER_WINDOW = 128;

/** The longest `resourceId`, in characters. */
export const MAX_RESOURCE_ID_LENGTH = 1024;

/** The longest `resourceKey`, in characters. */
export const MAX_RESOURCE_KEY_LENGTH = 256;

/** The longest text in a `reference`, in characters: any value in it, and any name. */
export const MAX_REFERENCE_TEXT_LENGTH = 1024;

/** The most the JSON of `resourceData` may take, in bytes of UTF-8 (64 KiB). */
export const MAX_RESOURCE_DATA_BYTES = 64 * 1024;

/** The most the JSON of a whole request may take, in bytes of UTF-8 (128 KiB), as the typed start would send it. */
export const MAX_REQUEST_BYTES = 128 * 1024;

/** What the host answers a start: the forward it started, as far as the window reads it (its id and the port it listens on), or none. */
export type PortForwardStarted = { readonly id: string; readonly local_port: number } | null;

/** What of the runtime's typed start the host asks. Answers the forward the host started (or `null`), and rejects with the host's error; it may also throw before it asks, for a request it cannot encode. */
export type PortForwardStart = (plugin: string, connection: string, request: NetworkerClient.PortForwardSessionRequest) => Promise<PortForwardStarted>;

/** What of the runtime's close the host asks: ends a forward by its id. Resolves when the host has closed it (the session it answers is not read) and rejects with the host's error. */
export type PortForwardStop = (sessionId: string) => Promise<unknown>;

/** The host's networker, as far as a page's forward asks it: the typed start, and the close by id. */
export type PortForwardNetwork = {
  readonly start: PortForwardStart;
  readonly stop: PortForwardStop;
  /** Calls `listener` with the id of each forward the host says it closed, whoever closed it; answers the function that stops the calls. */
  readonly onClosed: ClosedFeed;
};

/** What a handle that can forward is given: the networker's calls, the way to show the Ports tool once a forward has started, whether a user action is under way, and whether a plugin runs. */
export type PortForwarding = PortForwardNetwork & {
  /** Shows the Ports tool: the panel opens on it. Called once for each forward that started, after the host has answered, and never for one that did not. */
  readonly revealPortsTool: () => void;
  /** Whether a user action (a click, a key press) is under way now: `true` inside the few seconds of one, `false` outside, `undefined` when the engine cannot tell. */
  readonly userActivation: () => boolean | undefined;
  /** What the window knows of whether a plugin runs: the forwards of a plugin that stopped are gone, and the host says nothing of it. */
  readonly plugins: PluginPresence;
};

/** What `ports.forward` and a forward's `stop` reject with. The contract says it as a type (`PortForwardErrorV1`); the class is the host's, and a page tells it by its name. */
export class PortForwardError extends Error implements PortForwardErrorV1 {
  override readonly name = 'PortForwardError';
  readonly code: PortForwardErrorCodeV1;
  declare readonly limit?: number | undefined;

  constructor(code: PortForwardErrorCodeV1, message: string, options?: ErrorOptions & { readonly limit?: number }) {
    const { limit, ...errorOptions } = options ?? {};
    super(message, errorOptions);
    this.code = code;
    if (limit !== undefined) {
      this.limit = limit;
    }
  }
}

/** A size in bytes as the contract says it. */
const kib = (bytes: number): string => `${String(bytes / 1024)} KiB`;

/** The words of what the host refuses before it asks anything. They say what to change, to a person who writes or runs the page, and name the member and the number that was passed. */
const REFUSED = {
  resource: 'The forward names no resource.',
  remote: 'The port of the resource must be a whole number from 1 to 65535.',
  local: 'The port on this computer must be a whole number from 1 to 65535, or left out to take a free one.',
  protocol: 'The protocol must be TCP or UDP.',
  none: 'The host did not start the forward.',
  noPort: 'The host did not say which port the forward listens on.',
  action: 'A forward can only be started from a user action: a click or a key press.',
  actionUnknown: 'This window cannot tell a user action from a script, so it cannot start a forward.',
  id: `The resourceId is longer than ${String(MAX_RESOURCE_ID_LENGTH)} characters.`,
  key: `The resourceKey is longer than ${String(MAX_RESOURCE_KEY_LENGTH)} characters.`,
  text: `A text in the reference is longer than ${String(MAX_REFERENCE_TEXT_LENGTH)} characters.`,
  reference: `The reference is larger than ${kib(MAX_REQUEST_BYTES)}.`,
  referenceDeep: `The reference is nested more than ${String(MAX_DEPTH)} levels deep, or refers to itself.`,
  data: `The resourceData is larger than ${kib(MAX_RESOURCE_DATA_BYTES)}.`,
  dataDeep: `The resourceData is nested more than ${String(MAX_DEPTH)} levels deep, or refers to itself.`,
  request: `The request is larger than ${kib(MAX_REQUEST_BYTES)}.`,
  requestDeep: `The request is nested more than ${String(MAX_DEPTH)} levels deep, or refers to itself.`,
} as const;

/** What each way a value can be too large is said as, for the reference, the body and the whole request. */
const REFERENCE_WORDS: Readonly<Record<Overrun, string>> = { over: REFUSED.reference, deep: REFUSED.referenceDeep, text: REFUSED.text };
const DATA_WORDS: Readonly<Record<Exclude<Overrun, 'text'>, string>> = { over: REFUSED.data, deep: REFUSED.dataDeep };
const REQUEST_WORDS: Readonly<Record<Exclude<Overrun, 'text'>, string>> = { over: REFUSED.request, deep: REFUSED.requestDeep };

/**
 * The codes of the contract, and the words each is given when the host gave none of its own that a person can read: the sentences of the host's own classes of error (`backend/pkg/apperror/resource.go`, `classifyResource`), and for
 * a connection that is not started the one that says what helps. The general sentence is the runtime's own for an error it has nothing to say of (`parseAppError`).
 */
const WORDS: Readonly<Record<PortForwardErrorCodeV1, string>> = {
  INVALID_REQUEST: 'The request is invalid.',
  UNSUPPORTED: 'This operation is not supported.',
  FORBIDDEN: 'The operation is not permitted.',
  UNAUTHORIZED: 'The provider requires authentication.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The operation conflicts with current state.',
  CANCELLED: 'The operation was cancelled.',
  TIMEOUT: 'The operation exceeded its deadline.',
  UNAVAILABLE: 'The source is unavailable.',
  CONNECTION_ERROR: 'The connection is not started, or could not be reached.',
  RESOURCE_LIMIT: 'The operation exceeds a host resource limit.',
  PROVIDER_ERROR: 'The provider could not complete the operation.',
  INTERNAL: 'The operation could not be completed.',
  UNKNOWN: 'The operation could not be completed.',
};

/** What the runtime says of an error it can read nothing of (`parseAppError`), and of the classes whose text it never passes on. It says less than the words of the class do. */
const GENERAL = 'The operation could not be completed.';

const isCode = (value: string): value is PortForwardErrorCodeV1 => Object.hasOwn(WORDS, value);

/** What a table holds for a key, and nothing for one it does not hold: a key that comes from the host's answer is never looked up in the object's own prototype. */
const lookup = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The codes the host's own classes put together with another (`classifyResource`): the contract says each as the one it is put with. */
const SAID_AS: Readonly<Record<string, PortForwardErrorCodeV1>> = {
  ALREADY_EXISTS: 'CONFLICT',
  CERTIFICATE_ERROR: 'CONNECTION_ERROR',
};

/**
 * The class an error's type names, for an answer that has no code (`codeFromType`, `backend/pkg/apperror/resource.go`): the host's own errors of a lookup (a plugin, a connection, a session) carry a type and no code. The type the runtime
 * gives to what it could not read at all (`omniview:internal`) names no class, so it is not here.
 */
const CODE_OF_TYPE: Readonly<Record<string, PortForwardErrorCodeV1>> = {
  [ErrorTypes.VALIDATION]: 'INVALID_REQUEST',
  [ErrorTypes.NOT_IMPLEMENTED]: 'UNSUPPORTED',
  [ErrorTypes.RESOURCE_FORBIDDEN]: 'FORBIDDEN',
  [ErrorTypes.RESOURCE_UNAUTHORIZED]: 'UNAUTHORIZED',
  [ErrorTypes.RESOURCE_NOT_FOUND]: 'NOT_FOUND',
  [ErrorTypes.PLUGIN_NOT_FOUND]: 'NOT_FOUND',
  [ErrorTypes.CONNECTION_NOT_FOUND]: 'NOT_FOUND',
  [ErrorTypes.SESSION_NOT_FOUND]: 'NOT_FOUND',
  [ErrorTypes.RESOURCE_CONFLICT]: 'CONFLICT',
  [ErrorTypes.CANCELLED]: 'CANCELLED',
  [ErrorTypes.RESOURCE_TIMEOUT]: 'TIMEOUT',
  [ErrorTypes.CONNECTION_FAILED]: 'UNAVAILABLE',
  [ErrorTypes.RESOURCE_LIMIT]: 'RESOURCE_LIMIT',
  [ErrorTypes.RESOURCE_PROVIDER_ERROR]: 'PROVIDER_ERROR',
};

/**
 * The code of the contract for what the runtime read of the host's answer: the code the answer has, when it has one (a code the contract does not list is `UNKNOWN`: it is not guessed from the type), and the class its type names
 * when it has none. An answer that has neither is `UNKNOWN`.
 */
function codeOf(read: AppError): PortForwardErrorCodeV1 {
  if (read.code !== undefined) {
    const said = lookup(SAID_AS, read.code) ?? read.code;
    return isCode(said) ? said : 'UNKNOWN';
  }

  return lookup(CODE_OF_TYPE, read.type) ?? 'UNKNOWN';
}

/**
 * The host's sentence, when a person may read it as it is: one plain line, as the window says a failed connection (`safeReason`), that is not a dump (braces, or a key and its value in quotes: the host's own error passed on as text) and
 * not the runtime's general sentence, which says less than the class's own words.
 */
function plainOf(detail: string): string | undefined {
  const line = safeReason(detail, '');
  return line === '' || line === GENERAL || /[{}]/.test(line) || /"[^"]*"\s*:/.test(line) ? undefined : line;
}

/** The refusal for what a call to the host rejected with (or threw): its code, and plain words. The error itself is the cause, for whoever has to find out more. */
function refusalOf(error: unknown): PortForwardError {
  const read = parseAppError(error);
  const code = codeOf(read);
  return new PortForwardError(code, plainOf(read.detail) ?? WORDS[code], { cause: error });
}

const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const PROTOCOLS: readonly unknown[] = ['TCP', 'UDP'];

/** Refuses, in `words`, a value that was weighed and does not fit its bound; a number is the weight of one that does. */
function within<K extends Overrun>(weighed: number | K, words: Readonly<Record<K, string>>): void {
  if (typeof weighed !== 'number') {
    throw new PortForwardError('INVALID_REQUEST', words[weighed]);
  }
}

/**
 * The typed start's request for what a page asked, in the plugin and the connection the handle is for: the members the page gave and no others, a free local port and TCP when it said none, and the route of the page's connection
 * when it gave a reference, because the host's networker refuses a reference without a route of the connection it is started in. The request has no route of its own, so one a plugin wrote anyway is not read. Throws the refusal, in words, for
 * what no forward can be made of, and for what is over a bound (PF2): the checks of the shape come first, because they cost nothing, then the id's length (before the id is read at all), the key's, the reference's texts and size, the body's
 * size and, last, the size of what is to be sent. What the host's networker would refuse for its own reasons (a port in use, a resource it cannot reach) is its to say, and is.
 */
function optionsOf(plugin: string, connection: string, request: unknown): NetworkerClient.PortForwardSessionRequest {
  // A request from a plugin written without the types is read like any other: what is not an object names no resource.
  const given: Partial<PortForwardRequestV1> = isObject(request) ? request : {};
  const { resourceId, resourceKey, reference, resourceData, remotePort, localPort, protocol } = given;
  if (typeof resourceId !== 'string') {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.resource);
  }

  // The length before anything else reads the text: an id of a megabyte is refused, and not trimmed.
  if (resourceId.length > MAX_RESOURCE_ID_LENGTH) {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.id);
  }

  if (resourceId.trim() === '') {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.resource);
  }

  if (!isPort(remotePort)) {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.remote);
  }

  if (localPort !== undefined && !isPort(localPort)) {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.local);
  }

  if (protocol !== undefined && !PROTOCOLS.includes(protocol)) {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.protocol);
  }

  if (typeof resourceKey === 'string' && resourceKey.length > MAX_RESOURCE_KEY_LENGTH) {
    throw new PortForwardError('INVALID_REQUEST', REFUSED.key);
  }

  if (reference !== undefined) {
    within(weigh(reference, MAX_REQUEST_BYTES, MAX_REFERENCE_TEXT_LENGTH), REFERENCE_WORDS);
  }

  if (resourceData !== undefined) {
    within(weigh(resourceData, MAX_RESOURCE_DATA_BYTES), DATA_WORDS);
  }

  const options: NetworkerClient.PortForwardSessionRequest = {
    local_port: localPort ?? 0,
    remote_port: remotePort,
    protocol: protocol ?? 'TCP',
    connection_type: 'RESOURCE',
    connection: {
      plugin_id: plugin,
      connection_id: connection,
      resource_id: resourceId,
      resource_key: resourceKey ?? '',
      ...(reference === undefined ? {} : { reference, route: { connection } }),
      ...(resourceData === undefined ? {} : { resource_data: resourceData }),
    },
  };
  // The whole of what is sent, as the runtime's encoder will count it: the parts were each within their bounds, and the sum may not be.
  within(weigh(options, MAX_REQUEST_BYTES), REQUEST_WORDS);
  return options;
}

/** Closes a forward through the host. A forward the host does not have is closed already (the person stopped it in the Ports tool, or another window did), and what a caller wants is that it does not run: that is success. */
async function close(stop: PortForwardStop, sessionId: string): Promise<void> {
  try {
    await stop(sessionId);
  } catch (error) {
    if (parseAppError(error).type === ErrorTypes.SESSION_NOT_FOUND) {
      return;
    }

    throw refusalOf(error);
  }
}

/** The refusal for a cap that is full: the number, as the error's `limit` and in the words. */
function fullOf(full: Extract<Taken, { readonly kind: 'full' }>): PortForwardError {
  const words = full.scope === 'connection' ? `This plugin already holds ${String(full.limit)} forwards in this connection. Stop one first.` : `This window already holds ${String(full.limit)} forwards. Stop one first.`;
  return new PortForwardError('RESOURCE_LIMIT', words, { limit: full.limit });
}

/** The `stop` of one forward: it asks the host once, and every call, a later one and one made while the host is still closing it, has that one outcome (the same answer, or the same refusal). The forward's place in the count is given back when the host has closed it. */
function stopOf(stop: PortForwardStop, sessionId: string, place: Place): () => Promise<void> {
  let outcome: Promise<void> | undefined;
  return async () => {
    outcome ??= close(stop, sessionId).then(() => {
      place.release();
    });
    return outcome;
  };
}

/**
 * `ctx.panel.ports` for the pages of `plugin` that are read in `connection`, which is a connection: a page that is read in none has no ports member (`panelHost.ts`), because nothing would say where to forward. A call is asked
 * for a user action, then for a request within the bounds, then for a place in the window's count (`ledger`, which every handle of the window shares), and only then is the host asked (see the head of this file). The place is given back
 * when the start fails or does not answer a forward, and is held, under the forward's id, from the moment the host has answered one. The Ports tool is shown only after the host answered a forward, and it is not the forward's failure when
 * it cannot be shown: the forward started, and the answer is the forward. The member and each answer are frozen: the handle is shared by every page of the plugin in the connection, and a page cannot change what the others call.
 */
export function portsOf(forwarding: PortForwarding, ledger: ForwardLedger, plugin: string, connection: string): NonNullable<PanelHostV1['ports']> {
  return Object.freeze({
    forward: async (request: PortForwardRequestV1): Promise<PortForwardSessionV1> => {
      // First, at the call, before this function gives up its turn: a user action's activation lasts a few seconds, and whatever is read or awaited first is time that it does not have.
      const acting = forwarding.userActivation();
      if (acting !== true) {
        throw new PortForwardError('FORBIDDEN', acting === false ? REFUSED.action : REFUSED.actionUnknown);
      }

      const options = optionsOf(plugin, connection, request);
      const taken = ledger.reserve(plugin, connection);
      if (taken.kind === 'full') {
        throw fullOf(taken);
      }

      const { place } = taken;
      let started: PortForwardStarted;
      try {
        started = await forwarding.start(plugin, connection, options);
      } catch (error) {
        place.release();
        throw refusalOf(error);
      }

      if (started === null || typeof started.id !== 'string' || started.id === '') {
        place.release();
        throw new PortForwardError('UNKNOWN', REFUSED.none);
      }

      const { id: sessionId, local_port: localPort } = started;
      place.hold(sessionId);
      const stop = stopOf(forwarding.stop, sessionId, place);
      if (!isPort(localPort)) {
        // The host started a forward and did not say which port it listens on: it cannot be told to the page, and a forward nobody can address is one nobody can end, so it is ended here and the call is refused. The place is given back
        // when it is ended; when it cannot be, it may be running, and the place is held until the host says it is closed.
        await stop().catch((error: unknown) => {
          console.warn('[ports] a forward the host started without a port could not be stopped', error);
        });
        throw new PortForwardError('UNKNOWN', REFUSED.noPort);
      }

      try {
        forwarding.revealPortsTool();
      } catch (error) {
        console.warn('[ports] the Ports tool could not be shown', error);
      }

      return Object.freeze({ sessionId, localPort, stop });
    },
  });
}

/**
 * What the window's engine says of a user action in progress: `navigator.userActivation.isActive`, which is `true` for about five seconds after a click, a key press or a touch and `false` otherwise. `undefined` in an engine that has no
 * such API (an older one, and the test environment): it cannot tell a click from a script, and a forward is refused there. The engine is asked at each call and the answer is kept by nobody.
 */
export function windowActivation(): boolean | undefined {
  // The type says the member is always there. An engine that predates it has none, so the reading is typed as what it can be.
  const { userActivation }: { readonly userActivation?: { readonly isActive: boolean } | undefined } = navigator;
  return userActivation?.isActive;
}
