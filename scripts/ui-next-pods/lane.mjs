// The scope lane's side of the Pods cluster check (H6, plugin PR #272): the page says the connection by its NAME, which is the context kubectl calls current, and never by its ID.
// Since #272 a connection's ID is derived, `<slug>-<10 hex>`, from the path of the kubeconfig and the context name. The check's kubeconfig lives in a temporary directory, so the ID is another
// one on every run: nothing here writes one down. The ID is read from the host's own list of connections (`listConnections` in parity.mjs) and is only what the lane must NOT say.
// Pure functions only (no process, no browser), so `lane.test.mjs` proves each failure mode without a cluster. The browser part is `readPage` and the first test of the check.

/** The shape of a derived ID: the slug the plugin made of the context name, a dash, and ten lower-case hex digits (docs/ui-next/status/H6.md). */
export const DERIVED_ID = /-[0-9a-f]{10}$/;

/**
 * The one assertion about the lane: the text of its Connection face is the name of the connection the page reads, which for a kubeconfig of one context is `kubectl config current-context`.
 *   read      the text of the Connection face as drawn, `null` when the page has no such face
 *   context   `kubectl config current-context` (the oracle for the name)
 *   id        the ID of the connection of that context in the host's list: what the lane must not print
 * Returns the problems as readable lines; empty when the lane says the name. What cannot be compared is a problem, never a pass.
 */
export function compareLane(read, { context, id }) {
  const problems = [];
  if (context === undefined || context === '') {
    problems.push('kubectl has no current context, so the check cannot compare the lane');
  }
  if (id === undefined || id === '') {
    problems.push(`the host lists no connection for the context ${JSON.stringify(context)}, so the check cannot tell the name from the ID`);
  }
  if (read === null || read === undefined) {
    problems.push('the page draws no Connection face in its scope lane');
  } else if (id !== undefined && id !== '' && read === id) {
    problems.push(`the lane prints the connection's ID (${id}), where a person reads its name ${JSON.stringify(context)}`);
  } else if (context !== undefined && context !== '' && read !== context) {
    problems.push(`the lane says ${JSON.stringify(read)}, kubectl's current context is ${JSON.stringify(context)}${DERIVED_ID.test(read) ? '; the text is shaped like a derived ID (<slug>-<10 hex>)' : ''}`);
  }

  return problems;
}

/**
 * C1h: the ID of the connection is a key and is drawn nowhere. `drawn` is every text the window draws and every `aria-label`, `title`, `alt`, `placeholder` and value it carries (`readDrawn`, below);
 * the problems are readable lines, empty when the ID is nowhere in it. An unknown ID is a problem, never a pass.
 */
export function compareDrawn(drawn, id) {
  if (id === undefined || id === '') {
    return ['the host lists no connection ID, so the check cannot tell whether the window draws it'];
  }

  const at = drawn.indexOf(id);
  return at === -1 ? [] : [`the window draws the connection's ID (${id}): "${drawn.slice(Math.max(0, at - 40), at + id.length + 40)}"`];
}

/** Everything the page draws or names, as one text: for `compareDrawn`. */
export function readDrawn(page) {
  return page.evaluate(() => {
    const attributes = ['aria-label', 'aria-description', 'title', 'alt', 'placeholder', 'value'];
    const parts = [document.body.innerText];
    for (const element of document.querySelectorAll('*')) {
      for (const name of attributes) {
        const value = element.getAttribute(name);
        if (value) parts.push(value);
      }
    }
    return parts.join('\n');
  });
}
