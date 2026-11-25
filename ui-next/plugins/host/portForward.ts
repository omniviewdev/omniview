import type { NetworkerClient } from '@omniviewdev/runtime/api';
import { ErrorTypes, parseAppError, type AppError } from '@omniviewdev/runtime/ui/v1';
import { LOOPBACK } from '../../shell/panel/ports/model';
import type { PanelHostV1, PortForwardErrorCodeV1, PortForwardErrorV1, PortForwardRequestV1, PortForwardSessionV1 } from '../contract/v1';
import { safeReason } from './connections/words';

// What `ctx.panel.ports` is for one page (contract/v1.ts, `PanelHostV1.ports`, PF1): a plugin's page names a resource and its ports, and the host starts the forward. The plugin that asks and the connection are not the request's:
// they are the handle's, made for the plugin and for the connection the page is read in (`panelHost.ts`), so a page forwards in its own connection and in no other whatever it writes. The request is the page's words and becomes
// the runtime's typed start (`NetworkerClient.StartResourcePortForwardingSession`) exactly: what the page gave, and the plugin and the connection, and nothing else. The host's networker and the Ports tool are given (`PortForwarding`),
// so what a forward does is tested with no runtime and no window; `PluginHostScreen.tsx` binds the networker to the runtime and `PluginHost.tsx` the tool.
//
// WHAT THE PAGE IS ANSWERED is the forward as the host's session states it (its id and the port it listens on), the address the host reaches it at, and a way to stop it. The address is the host's assumption, the loopback the Ports tool
// says too (one constant, `LOOPBACK`): the session states no address. The stop closes the session the forward was answered with, through the host, by its id, once, and every call has the one outcome. The host closes by id alone and the
// SDK gives every session a fresh UUID, which is what makes an id one forward's: `PortForwardSessionV1.stop` says what a forwarder that chose ids of its own would leave. The forward is the host's and not the page's (`PanelHostV1.ports`
// says how long it lives), so nothing here ends it but that stop.
//
// WHAT THE PAGE IS REFUSED WITH is a `PortForwardError`, and it is a REJECTION: neither call throws into the caller, and a plugin that awaits the answer in a chain of promises hears of a refusal as of any failure. Its code is the
// host's own when the host's answer has one, read by the runtime's one parser (`parseAppError`, decision R13) and never from a text, and its words are the host's own sentence when that is one plain line, else the words of the code's
// class. A sentence that is a dump (a structure, a key and a value: what a refusal looks like when the host's own error was passed on as text) or the runtime's general one is not read out; the error the caller threw is the `cause`.

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
};

/** What a handle that can forward is given: the networker's calls, and the way to show the Ports tool once a forward has started. */
export type PortForwarding = PortForwardNetwork & {
  /** Shows the Ports tool: the panel opens on it. Called once for each forward that started, after the host has answered, and never for one that did not. */
  readonly revealPortsTool: () => void;
};

/** What `ports.forward` and a forward's `stop` reject with. The contract says it as a type (`PortForwardErrorV1`); the class is the host's, and a page tells it by its name. */
export class PortForwardError extends Error implements PortForwardErrorV1 {
  override readonly name = 'PortForwardError';
  readonly code: PortForwardErrorCodeV1;

  constructor(code: PortForwardErrorCodeV1, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

/** The words of what the host refuses before it asks anything. They say what to change, to a person who writes or runs the page. */
const REFUSED = {
  resource: 'The forward names no resource.',
  remote: 'The port of the resource must be a whole number from 1 to 65535.',
  local: 'The port on this computer must be a whole number from 1 to 65535, or left out to take a free one.',
  protocol: 'The protocol must be TCP or UDP.',
  none: 'The host did not start the forward.',
  noPort: 'The host did not say which port the forward listens on.',
} as const;

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

/**
 * The typed start's request for what a page asked, in the plugin and the connection the handle is for: the members the page gave and no others, a free local port and TCP when it said none, and the route of the page's connection
 * when it gave a reference, because the host's networker refuses a reference without a route of the connection it is started in. The request has no route of its own, so one a plugin wrote anyway is not read. Throws the refusal, in words, for
 * what no forward can be made of; what the host's networker would refuse for its own reasons (a port in use, a resource it cannot reach) is its to say, and is.
 */
function optionsOf(plugin: string, connection: string, request: unknown): NetworkerClient.PortForwardSessionRequest {
  // A request from a plugin written without the types is read like any other: what is not an object names no resource.
  const given: Partial<PortForwardRequestV1> = isObject(request) ? request : {};
  const { resourceId, resourceKey, reference, resourceData, remotePort, localPort, protocol } = given;
  if (typeof resourceId !== 'string' || resourceId.trim() === '') {
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

  return {
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

/** The `stop` of one forward: it asks the host once, and every call, a later one and one made while the host is still closing it, has that one outcome (the same answer, or the same refusal). */
function stopOf(stop: PortForwardStop, sessionId: string): () => Promise<void> {
  let outcome: Promise<void> | undefined;
  return async () => {
    outcome ??= close(stop, sessionId);
    return outcome;
  };
}

/**
 * `ctx.panel.ports` for the pages of `plugin` that are read in `connection`, which is a connection: a page that is read in none has no ports member (`panelHost.ts`), because nothing would say where to forward. The Ports tool is shown only
 * after the host answered a forward, and it is not the forward's failure when it cannot be shown: the forward started, and the answer is the forward. The member and each answer are frozen: the handle is shared by every page of the plugin in
 * the connection, and a page cannot change what the others call.
 */
export function portsOf(forwarding: PortForwarding, plugin: string, connection: string): NonNullable<PanelHostV1['ports']> {
  return Object.freeze({
    forward: async (request: PortForwardRequestV1): Promise<PortForwardSessionV1> => {
      const options = optionsOf(plugin, connection, request);
      let started: PortForwardStarted;
      try {
        started = await forwarding.start(plugin, connection, options);
      } catch (error) {
        throw refusalOf(error);
      }

      if (started === null || typeof started.id !== 'string' || started.id === '') {
        throw new PortForwardError('UNKNOWN', REFUSED.none);
      }

      const { id: sessionId, local_port: localPort } = started;
      const stop = stopOf(forwarding.stop, sessionId);
      if (!isPort(localPort)) {
        // The host started a forward and did not say which port it listens on: it cannot be told to the page, and a forward nobody can address is one nobody can end, so it is ended here and the call is refused.
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

      return Object.freeze({ sessionId, localPort, localHost: LOOPBACK, stop });
    },
  });
}
