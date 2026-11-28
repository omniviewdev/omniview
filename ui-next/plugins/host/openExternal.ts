import { openExternalURL } from '@omniviewdev/runtime/api';

/**
 * Opens an address outside the app, in the system's browser, through the host's opener (`AppService.OpenExternalURL`): the host checks the address (http and https only, no user information, not one of its own servers, at most 2,083 bytes) and
 * opens it on the machine that runs it, with no shell. The Ports tool opens a forward's address with it, and only a forward whose producer says it listens on this computer: the browser that opens it is the one that can reach it, and the Terminal tool opens a link a
 * person follows in a terminal's output. The caller gives it only addresses it made or found, and the page's own checks stay the first gate: the host is the last. A refusal of the host is the call's rejection (`ExternalURLRefusedError`, with its typed reason), which the
 * caller says in its own words.
 */
export async function openExternal(url: string): Promise<void> {
  await openExternalURL(url);
}
