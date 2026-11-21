import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDrawn, compareLane, DERIVED_ID } from './lane.mjs';

// The context kubectl calls current, and the ID the plugin derives for the connection of that name. The kubeconfig of the check lives in a temp directory and the ID is a hash of its path, so the ID
// is another one on every run: no test writes one into the check, and these are the shapes of two runs.
const CONTEXT = 'kind-ui-next-pods';
const FIRST_RUN = { context: CONTEXT, id: 'kind-ui-next-pods-54c660ecd1' };
const SECOND_RUN = { context: CONTEXT, id: 'kind-ui-next-pods-ef801541b4' };

test('a lane that says the name of the context agrees, whatever the ID of the run is', () => {
  assert.deepEqual(compareLane(CONTEXT, FIRST_RUN), []);
  assert.deepEqual(compareLane(CONTEXT, SECOND_RUN), []);
});

test('negative control: the lane that prints the connection\'s ID (what plugin #272 drew before the UI moved to the name) is reported, with the ID in the message', () => {
  for (const run of [FIRST_RUN, SECOND_RUN]) {
    const problems = compareLane(run.id, run);
    assert.equal(problems.length, 1, problems.join('; '));
    assert.match(problems[0], new RegExp(`the lane prints the connection's ID \\(${run.id}\\)`));
    assert.match(problems[0], /where a person reads its name "kind-ui-next-pods"/);
  }
});

test('negative control: text shaped like a derived ID is reported as such even when the host\'s list does not carry that ID (another connection\'s, an older run\'s)', () => {
  const problems = compareLane('kind-ui-next-pods-0123456789', FIRST_RUN);
  assert.equal(problems.length, 1, problems.join('; '));
  assert.match(problems[0], /the lane says "kind-ui-next-pods-0123456789", kubectl's current context is "kind-ui-next-pods"/);
  assert.match(problems[0], /shaped like a derived ID/);
});

test('negative control: another name, a word of the lane that is not a name, and no face at all are each reported and never pass', () => {
  assert.match(compareLane('kind-other', FIRST_RUN).join('\n'), /the lane says "kind-other", kubectl's current context is "kind-ui-next-pods"/);
  assert.doesNotMatch(compareLane('kind-other', FIRST_RUN).join('\n'), /shaped like a derived ID/);
  assert.match(compareLane('Loading…', FIRST_RUN).join('\n'), /the lane says "Loading…"/);
  assert.match(compareLane('None', FIRST_RUN).join('\n'), /the lane says "None"/);
  assert.match(compareLane('', FIRST_RUN).join('\n'), /the lane says ""/);
  assert.deepEqual(compareLane(null, FIRST_RUN), ['the page draws no Connection face in its scope lane']);
});

test('what cannot be compared is a problem and never a pass: no current context in kubectl, no connection of that context in the host\'s list', () => {
  assert.match(compareLane(CONTEXT, { context: '', id: FIRST_RUN.id }).join('\n'), /kubectl has no current context/);
  assert.match(compareLane(CONTEXT, { context: undefined, id: FIRST_RUN.id }).join('\n'), /kubectl has no current context/);
  assert.match(compareLane(CONTEXT, { context: CONTEXT, id: undefined }).join('\n'), /the host lists no connection for the context "kind-ui-next-pods"/);
  assert.match(compareLane(CONTEXT, { context: CONTEXT, id: '' }).join('\n'), /the host lists no connection for the context "kind-ui-next-pods"/);
});

test('the derived ID has the plugin\'s shape: a slug, a dash and ten lower-case hex digits at the end', () => {
  assert.match('kind-ui-next-pods-54c660ecd1', DERIVED_ID);
  assert.match('context-ef801541b4', DERIVED_ID);
  assert.doesNotMatch('kind-ui-next-pods', DERIVED_ID);
  assert.doesNotMatch('kind-ui-next-pods-ef801541b', DERIVED_ID, 'nine digits');
  assert.doesNotMatch('kind-ui-next-pods-EF801541B4', DERIVED_ID, 'upper case');
  assert.doesNotMatch('arn:aws:eks:eu-west-1:1:cluster/prod', DERIVED_ID, 'a name that is not an ID');
});

test('the window that draws no ID agrees; one that draws it in a text or an accessible name is reported (negative control), and an unknown ID is a problem', () => {
  assert.deepEqual(compareDrawn(`Deployments, ${CONTEXT}\nKubernetes ${CONTEXT} Deployments`, FIRST_RUN.id), []);
  for (const drawn of [`Deployments · ${FIRST_RUN.id}`, `tab\nDeployments, ${CONTEXT} ${FIRST_RUN.id}`]) {
    const problems = compareDrawn(drawn, FIRST_RUN.id);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`draws the connection's ID \\(${FIRST_RUN.id}\\)`));
  }
  assert.equal(compareDrawn('anything', undefined).length, 1);
  assert.equal(compareDrawn('anything', '').length, 1);
});
