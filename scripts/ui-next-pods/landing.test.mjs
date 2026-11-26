import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLanding, CONNECTED, LANDING_TAB, LANDING_TABLE, listedProblems, readLanding } from './landing.mjs';
import { shortVersion } from './overview.mjs';

// The plugin's landing (plugin PR #289) against what kubectl alone says (landing.mjs, with its controls): how a snapshot of the page's table becomes a model, and the one assertion about it: the connection of the context kubectl
// calls current is listed and, once the check has opened it from the landing, it is Connected with the server's version. Nothing here needs a cluster or a browser: the readings below are what the page printed in a real run
// (Chromium, kind v1.35.0), before the press on the connection and after it.

const CONTEXT = 'kind-landing-pin';
const HEADS = ['Connection', 'Status', 'Kubernetes', 'Region', 'Actions'];
const row = (name, status, version) => ({ name, cells: [name, status, version, '—', 'Open'] });

/** The table once the connection was opened from it: the host started it, and the plugin read the server's version. */
const OPENED = { heads: HEADS, rows: [row(CONTEXT, 'Connected', 'v1.35.0')] };
/** The same table before the press: nothing started, so no version is known. */
const BEFORE = { heads: HEADS, rows: [row(CONTEXT, 'Disconnected', '—')] };
const WANTED = { context: CONTEXT, version: 'v1.35.0' };

/** A copy of a reading, changed by `change`: a seeded fault never touches the reading the other tests share. */
function seeded(change, from = OPENED) {
  const dom = structuredClone(from);
  change(dom);
  return dom;
}
const problemsOf = (dom, wanted = WANTED) => compareLanding(readLanding(dom), wanted);

test('the landing\'s tab and table are the ones the plugin\'s landing has', () => {
  assert.equal(LANDING_TAB, 'Kubernetes');
  assert.equal(LANDING_TABLE, 'Connections');
  assert.equal(CONNECTED, 'Connected');
});

test('readLanding reads each row of the table as a connection: its name, its state and its Kubernetes version, by the headers', () => {
  assert.deepEqual(readLanding(OPENED), [{ name: CONTEXT, status: 'Connected', version: 'v1.35.0' }]);
  assert.deepEqual(readLanding(BEFORE), [{ name: CONTEXT, status: 'Disconnected', version: '—' }]);
  assert.deepEqual(readLanding({ heads: HEADS, rows: [] }), []);
  // The columns are found by their headers, wherever they stand.
  const moved = { heads: ['Connection', 'Kubernetes', 'Status'], rows: [{ name: CONTEXT, cells: [CONTEXT, 'v1.35.0', 'Connected'] }] };
  assert.deepEqual(readLanding(moved), [{ name: CONTEXT, status: 'Connected', version: 'v1.35.0' }]);
});

test('readLanding reads a page that draws no table as null, never as a table of no connection, and a column the table lacks as undefined', () => {
  assert.equal(readLanding(null), null);
  assert.deepEqual(readLanding({ heads: ['Connection'], rows: [{ name: CONTEXT, cells: [CONTEXT] }] }), [{ name: CONTEXT, status: undefined, version: undefined }]);
});

test('a landing that lists the context, Connected, with the version kubectl says for the server agrees', () => {
  assert.deepEqual(problemsOf(OPENED), []);
});

test('a version of the shape of a managed cluster\'s is said in three numbers, as the plugin says it, and agrees with kubectl\'s whole version', () => {
  const eks = seeded((dom) => (dom.rows[0].cells[2] = 'v1.31.4'));
  assert.deepEqual(problemsOf(eks, { context: CONTEXT, version: shortVersion('v1.31.4-eks-aeac579') }), []);
});

test('the connection is found by its name among the others, whatever their states and versions', () => {
  const many = seeded((dom) => dom.rows.unshift(row('kind-other', 'Disconnected', '—'), row('kind-third', 'Connected', 'v1.30.2')));
  assert.deepEqual(problemsOf(many), []);
});

// Each control below is one fault seeded into a landing that otherwise agrees, and it must be caught by the rule it is named for and by no other (AGENTS 28).

test('control listed: a page that draws no table, a table of no connection and a table of other connections are each reported by the listed rule alone', () => {
  const wanted = `wanted one that lists "${CONTEXT}", the context kubectl calls current`;
  assert.deepEqual(problemsOf(null), [`listed: the page draws no table of connections (a region named "Connections"), ${wanted}`]);
  assert.deepEqual(problemsOf({ heads: HEADS, rows: [] }), [`listed: the table lists no connection, wanted one named "${CONTEXT}", the context kubectl calls current`]);
  const others = { heads: HEADS, rows: [row('kind-other', 'Connected', 'v1.35.0'), row('kind-third', 'Connected', 'v1.35.0')] };
  assert.deepEqual(problemsOf(others), [`listed: the table lists "kind-other", "kind-third", wanted one named "${CONTEXT}", the context kubectl calls current`]);
});

test('control listed: a connection named for the ID the host lists, or for what the name starts with, is not the context\'s', () => {
  assert.equal(problemsOf(seeded((dom) => (dom.rows[0].name = `${CONTEXT}-57a082bd74`))).length, 1);
  assert.equal(problemsOf(seeded((dom) => (dom.rows[0].name = 'kind-landing'))).length, 1);
  assert.match(problemsOf(seeded((dom) => (dom.rows[0].name = `${CONTEXT}-57a082bd74`)))[0], /^listed: the table lists "kind-landing-pin-57a082bd74", wanted one named "kind-landing-pin"/);
});

test('control state: a connection that the press did not start, one still starting, one that failed and one that needs a sign-in are each reported by the state rule alone', () => {
  for (const word of ['Disconnected', 'Connecting', 'Connection failed', 'Needs sign-in', '']) {
    const problems = problemsOf(seeded((dom) => (dom.rows[0].cells[1] = word)));
    assert.deepEqual(problems, [`state: the landing says "kind-landing-pin" is ${JSON.stringify(word)}, wanted "Connected": the press on it started the connection`], word);
  }
});

test('control: the landing as it stood before the press, read as if it were after, is reported by the state rule and the version rule, and by none other', () => {
  assert.deepEqual(problemsOf(BEFORE), [
    'state: the landing says "kind-landing-pin" is "Disconnected", wanted "Connected": the press on it started the connection',
    'version: the landing says the Kubernetes version of "kind-landing-pin" is "—", kubectl says the server is v1.35.0',
  ]);
});

test('control state: another connection that is Connected does not stand for the context\'s own', () => {
  const dom = seeded((value) => {
    value.rows[0].cells[1] = 'Disconnected';
    value.rows.push(row('kind-other', 'Connected', 'v1.35.0'));
  });
  assert.deepEqual(problemsOf(dom), ['state: the landing says "kind-landing-pin" is "Disconnected", wanted "Connected": the press on it started the connection']);
});

test('control version: a dash, an empty cell, another version and the whole version where the page says three numbers are each reported by the version rule alone', () => {
  for (const [text, said] of [['—', '"—"'], ['', '""'], ['v1.34.0', '"v1.34.0"'], ['v1.35.0-eks-aeac579', '"v1.35.0-eks-aeac579"'], ['1.35.0', '"1.35.0"'], ['v1.35', '"v1.35"']]) {
    const problems = problemsOf(seeded((dom) => (dom.rows[0].cells[2] = text)));
    assert.deepEqual(problems, [`version: the landing says the Kubernetes version of "kind-landing-pin" is ${said}, kubectl says the server is v1.35.0`], text);
  }
});

test('control version: a landing that agrees with one server and not with the one kubectl says, and a table with no Kubernetes column, are each reported by the version rule alone', () => {
  assert.deepEqual(problemsOf(OPENED, { context: CONTEXT, version: 'v1.31.4' }), ['version: the landing says the Kubernetes version of "kind-landing-pin" is "v1.35.0", kubectl says the server is v1.31.4']);
  const lacking = { heads: ['Connection', 'Status'], rows: [{ name: CONTEXT, cells: [CONTEXT, 'Connected'] }] };
  assert.deepEqual(problemsOf(lacking), ['version: the landing says the Kubernetes version of "kind-landing-pin" is undefined, kubectl says the server is v1.35.0']);
});

test('control state: a table with no Status column says no state, and is not Connected', () => {
  const lacking = { heads: ['Connection', 'Kubernetes'], rows: [{ name: CONTEXT, cells: [CONTEXT, 'v1.35.0'] }] };
  assert.deepEqual(problemsOf(lacking), ['state: the landing says "kind-landing-pin" is undefined, wanted "Connected": the press on it started the connection']);
});

test('what cannot be compared is a problem and never a pass: no current context in kubectl, no version for the server', () => {
  for (const context of ['', undefined]) {
    assert.deepEqual(problemsOf(OPENED, { context, version: 'v1.35.0' }), ['listed: kubectl has no current context, so the check cannot name the connection to open']);
    assert.deepEqual(listedProblems(readLanding(OPENED), context), ['listed: kubectl has no current context, so the check cannot name the connection to open']);
  }
  for (const version of ['', undefined]) {
    assert.deepEqual(problemsOf(OPENED, { context: CONTEXT, version }), ['version: kubectl says nothing of the server\'s version, so the check cannot compare the landing\'s']);
  }
});

test('listedProblems is the half of the assertion that needs no start: a table that lists the context has none, whatever the connection says of itself', () => {
  assert.deepEqual(listedProblems(readLanding(BEFORE), CONTEXT), []);
  assert.deepEqual(listedProblems(readLanding(OPENED), CONTEXT), []);
  assert.equal(listedProblems(readLanding(BEFORE), 'kind-other').length, 1);
  assert.equal(listedProblems(null, CONTEXT).length, 1);
});
