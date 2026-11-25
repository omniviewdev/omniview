import { Browser } from '@omniviewdev/runtime/runtime';

/**
 * Opens an address outside the app, in the system's browser: the host's own call (`Browser.OpenURL`), which opens it on the machine that runs the host. The Ports tool opens a forward's address with it, and only a forward whose producer says it listens on this
 * computer: the browser that opens it is the one that can reach it. The host checks the address again and may refuse it (one with a shell metacharacter in it), and a refusal is the call's rejection, which the caller says in its own words.
 * The caller gives it only addresses it made (`http://<host>:<port>` of a host the producer states).
 */
export async function openExternal(url: string): Promise<void> {
  await Browser.OpenURL(url);
}
