// How the seam check starts the host on a port it picked. The port is found by listening on port 0 and releasing it (`freePort`), and the host binds it a moment later: in between another process can take it, which the host reports
// as `failed to listen on 127.0.0.1:<port>: bind: address already in use` and exits. The host cannot be asked for port 0 (Wails maps it to 8080 and does not say which port it got), so a start that lost its port is tried again, a bounded
// number of times, and a start that failed for any other reason is not.

/** What the operating system says when a port is taken, in Node's own errors and in the host's output (`failed to listen on <address>: bind: address already in use`). */
export const PORT_LOST = /address already in use/i;

const pauseBriefly = () => new Promise((resolve) => setTimeout(resolve, 500));

/**
 * Calls `start(port, built)` and, when it fails because the host lost the port, calls it again. `built` is what the plugins' build wrote: a failed attempt hands it back on `error.built`, and the next attempt is given it, so the build
 * never repeats. A new attempt takes a port from `freePort()`, except with `keepPort`, where the same port is used after a short `pause`: a host that is restarted must come back on the port its page's origin was made of.
 * Any other error is thrown at once, unchanged. After `attempts` attempts that all lost the port, the error says which ports were tried and has the last failure as its `cause`.
 */
export async function startWithPortRetry({ port, freePort, start, attempts = 5, keepPort = false, log = console.error, pause = pauseBriefly }) {
  const tried = [];
  let built;
  let current = port;
  for (let attempt = 1; ; attempt += 1) {
    tried.push(current);
    try {
      return await start(current, built);
    } catch (error) {
      if (!(error instanceof Error) || !PORT_LOST.test(error.message)) throw error;
      built = error.built ?? built;
      if (attempt >= attempts) {
        throw new Error(`the host could not get a port in ${String(attempts)} tries (${tried.join(', ')}): ${error.message}`, { cause: error });
      }

      const next = keepPort ? current : await freePort();
      log(`seam: the host lost port ${String(current)} (address already in use), attempt ${String(attempt)} of ${String(attempts)}; trying ${keepPort ? 'it again' : String(next)}`);
      if (keepPort) await pause();
      current = next;
    }
  }
}
