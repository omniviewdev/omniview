import type { PortForwardRequestV1 } from '../../contract/v1';

// The ports fixture (`fixture-g-ports`, ../build.mjs `writePortsPlugin`): what its page, its build and the seam check that drives it all say, written once. The Go side that serves it says the same things in `../portforward` and
// `../ports-process` (a Go file cannot import this one, so `ports.test.ts` reads those two as text and holds them to these). Nothing here imports anything of the host but a type, so Node can read this file as it is.
//
// The plugin has one connection, `harbor`, because the host starts a forward in a connection it knows (a plugin with none cannot be asked to forward), and one resource, the target, which its networker forwards to a TCP
// server the plugin runs itself. The server sends the line `PF1-FIXTURE-HELLO` to whoever connects and sends back whatever it is sent: a client of a forward's local port that reads the line has reached the target.

export const PORTS_ID = 'fixture-g-ports';
export const PORTS_NAME = 'Seam Ports';
/** The plugin's one connection by its key, which a route carries (`#/fixture-g-ports/targets?connection=harbor-9c41e07ab2`), and by its name, which a window says. */
export const PORTS_CONNECTION_KEY = 'harbor-9c41e07ab2';
export const PORTS_CONNECTION_NAME = 'harbor';

/** The one resource the plugin forwards, the key its forwarder is registered under and the port it is said to serve (the remote port of the forward: `port <local> → :8080/TCP` in the Ports tool). */
export const TARGET_ID = 'fixture-target';
export const TARGET_RESOURCE_KEY = 'fixture:/targets';
export const TARGET_PORT = 8080;
/** The line the target sends first on every connection, without the newline that ends it. */
export const TARGET_GREETING = 'PF1-FIXTURE-HELLO';
/** Where the plugin's own forwarder listens (`../portforward/endpoint.go`: the loopback, which the Go side says once and `ports.test.ts` holds to this). The host's answer states no address unless a producer does, and this plugin's does not, so this is what its page says when the answer has none. */
export const FORWARD_HOST = '127.0.0.1';

/** The names of the three buttons, which is how a check finds them: the one that forwards, the one that stops what was forwarded and the one that forwards the same port again. */
export const FORWARD_LABEL = 'Forward fixture port';
export const STOP_LABEL = 'Stop fixture forward';
export const AGAIN_LABEL = 'Forward the same port again';

/** What the page says where it cannot forward, and why: a host that has no handle to forward with (an older host, or a window with no port-forward service), and a page that is open in no connection, which the host gives no handle for. */
export const NO_PORTS_WORDS = 'This version of the app cannot forward ports.';
export const NO_CONNECTION_WORDS = 'This page is open in no connection, so it cannot forward ports.';
/** What the page says, where it can forward, of the two buttons that need a forward the host has answered: there is none yet. */
export const NO_FORWARD_WORDS = 'No forward was started on this page yet.';
/** What the page says, where it can forward and has a forward, of the two buttons that were not pressed while the host answers the one that was: one call is under way at a time. */
export const PENDING_WORDS = 'The host has not answered the last press yet.';

/**
 * The names of the four buttons that drive the host's rules (PF2), which is how a check finds them: the one that asks for a thousand forwards at once, the one that stops every forward the page holds, the one that asks with an id of a mebibyte
 * and the one that asks after the action that made the press has lapsed.
 */
export const MANY_LABEL = 'Forward 1,000 times';
export const STOP_ALL_LABEL = 'Stop all of them';
export const LONG_ID_LABEL = 'Forward with a 1 MiB id';
export const LAPSED_LABEL = 'Forward after 6 seconds';

/** How many forwards the first of them asks, all in the press and all in flight at once: far more than a plugin may hold in a connection. */
export const ASKED = 1000;
/** The length, in characters, of the id the third asks with (`longIdRequest`): a mebibyte, far over any bound on an id. */
export const LONG_ID_LENGTH = 1_048_576;
/** How long the fourth waits before it asks, in milliseconds: longer than an action's activation lasts (about five seconds), so that the action that made the press has lapsed when the call is made. */
export const LAPSE_MS = 6000;
/** What the page says while the fourth waits. */
export const LAPSE_WORDS = 'Asking in 6 seconds, after the action has lapsed.';

/** The request the buttons make: the one resource and its port. It names no local port, so the host takes a free one (0 is not a way to say so: the host refuses it), unless it is given one: the port of a forward that was answered, asked for again. It is a new object each time. */
export const forwardRequest = (localPort: number | undefined = undefined): PortForwardRequestV1 => ({
  resourceId: TARGET_ID,
  resourceKey: TARGET_RESOURCE_KEY,
  remotePort: TARGET_PORT,
  ...(localPort === undefined ? {} : { localPort }),
});

/** The request of the third button: the first button's, with an id of `LONG_ID_LENGTH` characters. The id is made when the request is, so a page that is never pressed holds none of it. It is a new object each time. */
export const longIdRequest = (): PortForwardRequestV1 => ({ ...forwardRequest(), resourceId: 'x'.repeat(LONG_ID_LENGTH) });

/** Which of the seven buttons a call is of. */
export type ForwardAction = 'forward' | 'stop' | 'again' | 'many' | 'stop-all' | 'long-id' | 'lapsed';

/** What the page says of the calls that were asked at once: how many, how many started, how many were refused by each code (in the order each was first seen), the limit the first refusal that has one carries and the first refusal's words. */
export type AskedOutcome = {
  readonly kind: 'asked';
  readonly asked: number;
  readonly started: number;
  readonly refused: number;
  readonly codes: ReadonlyArray<readonly [string, number]>;
  readonly limit: number | undefined;
  readonly said: string | undefined;
};

/**
 * Where the buttons are: nothing pressed, a call under way, the page waiting to ask (the fourth button), a forward the host started or stopped, a refusal of either (it has the class the host gave it and its words), what became of
 * a thousand asks, or of the stop of all of them.
 */
export type ForwardOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly action: ForwardAction }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'started'; readonly sessionId: string; readonly localHost: string; readonly localPort: number }
  | { readonly kind: 'stopped'; readonly sessionId: string }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'stop-refused'; readonly code: string; readonly message: string }
  | AskedOutcome
  | { readonly kind: 'stopped-all'; readonly stopped: number; readonly of: number };

/** What the page says of a thousand asks, exactly: `Asked 1000 forwards: 64 started, 936 refused (RESOURCE_LIMIT 936, limit 64). The host said: ...`, with the limit only when a refusal carries one, and none of it after the count when nothing was refused. */
function askedWords({ asked, started, refused, codes, limit, said }: AskedOutcome): string {
  const head = `Asked ${asked} forwards: ${started} started, ${refused} refused`;
  if (refused === 0) {
    return `${head}.`;
  }

  const classes = codes.map(([code, count]) => `${code} ${count}`).join(', ');
  return `${head} (${classes}${limit === undefined ? '' : `, limit ${limit}`}). The host said: ${said ?? ''}`;
}

/**
 * What the page says of an outcome, in plain text; nothing before a press and while a call is under way (the button says that it is busy), and the words of the wait while the page waits. The forward the host started is said with where to
 * connect to it: `localHost:localPort`, the address the host's answer states and, when it states none, the one this plugin's own forwarder listens on (`FORWARD_HOST`). A stop of all of them says how many the host stopped, and how many it refused.
 */
export function outcomeWords(outcome: ForwardOutcome): string | undefined {
  switch (outcome.kind) {
    case 'waiting':
      return LAPSE_WORDS;
    case 'started':
      return `Forward session ${outcome.sessionId} on ${outcome.localHost}:${String(outcome.localPort)}`;
    case 'stopped':
      return `Stopped forward ${outcome.sessionId}`;
    case 'refused':
      return `Refused ${outcome.code}: ${outcome.message}`;
    case 'stop-refused':
      return `Stop refused ${outcome.code}: ${outcome.message}`;
    case 'asked':
      return askedWords(outcome);
    case 'stopped-all':
      return outcome.stopped === outcome.of ? `Stopped ${outcome.of} forwards.` : `Stopped ${outcome.stopped} of ${outcome.of} forwards; ${outcome.of - outcome.stopped} were refused.`;
    case 'idle':
    case 'pending':
      return undefined;
  }
}

/** The class the contract gives a rejection that is not the host's own: no class (`PortForwardErrorCodeV1`). */
const NO_CODE = 'UNKNOWN';

/** What the page says when the host's refusal of a start or of a stop has no words. */
export const START_FALLBACK = 'The host could not start the forward.';
export const STOP_FALLBACK = 'The host could not stop the forward.';

/** Whether a rejection is the host's own error. It is told by its NAME, `PortForwardError`, because a page cannot import its class. */
const fromHost = (error: unknown): error is Error => error instanceof Error && error.name === 'PortForwardError';

/** The class the host gave a refusal; any other rejection (an error of another name, a text) has none, and so has one whose `code` is not text. */
function codeOf(error: unknown): string {
  if (fromHost(error) && 'code' in error && typeof error.code === 'string' && error.code.trim() !== '') {
    return error.code;
  }

  return NO_CODE;
}

/** The number a refusal is about, when the host's own error carries one (`limit` of `PortForwardErrorV1`: the cap a refusal names): a whole number, and nothing for any other rejection. */
export function limitOf(error: unknown): number | undefined {
  if (fromHost(error) && 'limit' in error && typeof error.limit === 'number' && Number.isInteger(error.limit)) {
    return error.limit;
  }

  return undefined;
}

/** The words of a rejection: the message of an error, or a rejection that is only text, and never anything else of it (a stack is not for a person, and what the host's call was rejected with is for a log). A rejection that says nothing is given `fallback`. */
function wordsOf(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return text.trim() === '' ? fallback : text;
}

/** A rejection as the page says it: the class the host gave it (`UNKNOWN` when it gave none) and plain words, which are `fallback` when the rejection has none. Nothing else of it is read: never its JSON. */
export function refusalOf(error: unknown, fallback: string): { readonly code: string; readonly message: string } {
  return { code: codeOf(error), message: wordsOf(error, fallback) };
}

/**
 * What became of calls asked at once, from what each came to (`Promise.allSettled` answers in the order of the calls): how many started, how many were refused and by which code (in the order each was first seen, with how many), the limit
 * of the first refusal that carries one and the words of the first refusal. A refusal is read as any other is (`refusalOf`), so one that is not the host's is `UNKNOWN`, and one that says nothing has the words of the page's own.
 */
export function askedOf(results: ReadonlyArray<PromiseSettledResult<unknown>>): AskedOutcome {
  const codes = new Map<string, number>();
  let started = 0;
  let limit: number | undefined;
  let said: string | undefined;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      started += 1;
      continue;
    }

    const { code, message } = refusalOf(result.reason, START_FALLBACK);
    codes.set(code, (codes.get(code) ?? 0) + 1);
    limit ??= limitOf(result.reason);
    said ??= message;
  }

  return { kind: 'asked', asked: results.length, started, refused: results.length - started, codes: [...codes], limit, said };
}
