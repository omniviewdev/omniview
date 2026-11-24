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

/** The one resource the plugin forwards, the key its forwarder is registered under and the port it is said to serve (the remote port of the forward: `127.0.0.1:<local> → :8080/TCP` in the Ports tool). */
export const TARGET_ID = 'fixture-target';
export const TARGET_RESOURCE_KEY = 'fixture:/targets';
export const TARGET_PORT = 8080;
/** The line the target sends first on every connection, without the newline that ends it. */
export const TARGET_GREETING = 'PF1-FIXTURE-HELLO';

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

/** The request the buttons make: the one resource and its port. It names no local port, so the host takes a free one (0 is not a way to say so: the host refuses it), unless it is given one: the port of a forward that was answered, asked for again. It is a new object each time. */
export const forwardRequest = (localPort: number | undefined = undefined): PortForwardRequestV1 => ({
  resourceId: TARGET_ID,
  resourceKey: TARGET_RESOURCE_KEY,
  remotePort: TARGET_PORT,
  ...(localPort === undefined ? {} : { localPort }),
});

/** Which of the three buttons a call is of. */
export type ForwardAction = 'forward' | 'stop' | 'again';

/** Where the buttons are: nothing pressed, a call under way, a forward the host started or stopped, or a refusal of either. A refusal has the class the host gave it and its words. */
export type ForwardOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly action: ForwardAction }
  | { readonly kind: 'started'; readonly sessionId: string; readonly localHost: string; readonly localPort: number }
  | { readonly kind: 'stopped'; readonly sessionId: string }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'stop-refused'; readonly code: string; readonly message: string };

/**
 * What the page says of an outcome, in plain text; nothing before a press and while a call is under way (the button says that it is busy). The forward the host started is said with where to connect to it, as the host's
 * answer states it: `localHost:localPort`.
 */
export function outcomeWords(outcome: ForwardOutcome): string | undefined {
  switch (outcome.kind) {
    case 'started':
      return `Forward session ${outcome.sessionId} on ${outcome.localHost}:${String(outcome.localPort)}`;
    case 'stopped':
      return `Stopped forward ${outcome.sessionId}`;
    case 'refused':
      return `Refused ${outcome.code}: ${outcome.message}`;
    case 'stop-refused':
      return `Stop refused ${outcome.code}: ${outcome.message}`;
    case 'idle':
    case 'pending':
      return undefined;
  }
}

/** The class the contract gives a rejection that is not the host's own: no class (`PortForwardErrorCodeV1`). */
const NO_CODE = 'UNKNOWN';

/**
 * The class the host gave a refusal. The host's error is told by its NAME, `PortForwardError`, because a page cannot import its class; any other rejection (an error of another name, a text) has none, and so has one whose
 * `code` is not text.
 */
function codeOf(error: unknown): string {
  if (error instanceof Error && error.name === 'PortForwardError' && 'code' in error && typeof error.code === 'string' && error.code.trim() !== '') {
    return error.code;
  }

  return NO_CODE;
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
