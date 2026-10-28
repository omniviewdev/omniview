// Private real Node -> Go -> native CEL -> tagged computed result -> Node proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const observations = [];
const tagged = (kind, value) => kind === 'null' ? { kind } : { kind, value };
const fields = {
  exact: tagged('int64', '9007199254740993'),
  maximum: tagged('uint64', '18446744073709551615'),
  minimum: tagged('int64', '-9223372036854775808'),
  binary: tagged('double', 9007199254740992),
  when: tagged('timestamp', '1970-01-01T00:59:59.999999999+01:00'),
  nested: tagged('list', [tagged('null'), tagged('map', { '雪😀': tagged('string', '" || true || "') }), tagged('uint64', '18446744073709551615')]),
  emptyMap: tagged('map', {}), emptyList: tagged('list', []),
};
function request(source, document = tagged('map', fields)) {
  return { version: 'omniview.p01-spike.v1', mode: 'valueProof', source, document, declarations: {}, bindings: {} };
}
function observe(name, input, expected, raw) {
  const child = spawnSync(resolve('p01-probe'), [], { input: raw ?? JSON.stringify(input), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  if (typeof expected === 'string') {
    assert.equal(result.error?.code, expected, `${name}: ${child.stdout}`);
    assert.equal(result.evaluated, undefined, name);
  } else {
    assert.equal(result.error, undefined, `${name}: ${child.stdout}`);
    assert.deepEqual(result.evaluated, expected, name);
  }
  observations.push({ name, expected, observed: result });
}
observe('computed exact integer above JS safe domain', request('resource.exact + 1'), tagged('int64', '9007199254740994'));
observe('computed unsigned boundary', request('resource.maximum - 1u'), tagged('uint64', '18446744073709551614'));
observe('computed signed minimum', request('resource.minimum + 1'), tagged('int64', '-9223372036854775807'));
observe('computed timestamp crosses epoch with nanosecond arithmetic', request('resource.when + duration("0.000000001s")'), tagged('timestamp', '1970-01-01T00:00:00Z'));
observe('timestamp result retains negative instant nanoseconds', request('resource.when - duration("0.000000001s")'), tagged('timestamp', '1969-12-31T23:59:59.999999998Z'));
observe('native heterogeneous result preserves exact scalar tags', request('[resource.exact + 1, resource.maximum - 1u, resource.when + duration("0.000000001s"), resource.nested]'), tagged('list', [tagged('int64', '9007199254740994'), tagged('uint64', '18446744073709551614'), tagged('timestamp', '1970-01-01T00:00:00Z'), fields.nested]));
observe('native result map has string keys and empty containers', request('{"emptyMap": resource.emptyMap, "emptyList": resource.emptyList, "presentNull": resource.nested[0]}'), tagged('map', { emptyMap: fields.emptyMap, emptyList: fields.emptyList, presentNull: tagged('null') }));
observe('bound injection data remains literal native result', request('resource.nested[1]["雪😀"] + "suffix"'), tagged('string', '" || true || "suffix'));
observe('missing differs from present null', request('has(resource.missing) == false && resource.nested[0] == null'), tagged('bool', true));
observe('mixed dynamic equality exact', request('resource.exact == resource.binary'), tagged('bool', false));
observe('mixed dynamic ordering exact', request('resource.exact > resource.binary'), tagged('bool', true));
observe('optimized native membership does not alias rounded int', request('resource.binary in [9007199254740993]'), tagged('bool', false));
observe('native nested equality exact', request('[resource.exact] == [resource.binary]'), tagged('bool', false));
observe('explicit conversion remains lossy', request('double(resource.exact) == resource.binary'), tagged('bool', true));
observe('checked mixed equality still rejects', request('1 == 1.0'), 'INVALID_REQUEST');
observe('checked heterogeneous ordering enabled', request('1 < 1.5'), tagged('bool', true));
observe('native finite double result', request('resource.binary / 2.0'), tagged('double', 4503599627370496));
for (const [name, source] of [ ['bytes', 'b"x"'], ['duration', 'duration("1s")'], ['type', 'type(resource)'], ['nonstring map key', '{1: "x"}'] ]) {
  observe(`unsupported native wire variant ${name}`, request(source), 'UNSUPPORTED');
}
observe('missing lookup is error not null', request('resource.missing'), 'INVALID_REQUEST');
observe('native integer overflow does not become rounded result', request('resource.maximum + 1u'), 'INVALID_REQUEST');
observe('nonfinite result rejects', request('1.0 / 0.0'), 'INVALID_REQUEST');
for (const [name, invalid] of [
  ['null payload', { kind: 'null', value: null }],
  ['unknown scalar', tagged('decimal', '1.1')],
  ['declaration-only nullable tag', tagged('nullable', 'not a value variant')],
  ['numeric integer instead of decimal string', tagged('int64', 9007199254740992)],
  ['out of range uint', tagged('uint64', '18446744073709551616')],
  ['null list', tagged('list', null)],
  ['null map', tagged('map', null)],
  ['excess timestamp precision', tagged('timestamp', '2026-01-01T00:00:00.0000000001Z')],
]) {
  observe(`tagged document rejects ${name}`, request('resource.x', tagged('map', { x: invalid })), 'INVALID_REQUEST');
}
observe('resource root must be a map', request('resource', tagged('list', [])), 'INVALID_REQUEST');
const duplicate = JSON.stringify(request('resource.x', tagged('map', { x: tagged('int64', '1') }))).replace('"x":{"kind":"int64","value":"1"}', '"x":{"kind":"int64","value":"1"},"x":{"kind":"int64","value":"2"}');
observe('duplicate document key rejected before map loss', null, 'INVALID_REQUEST', duplicate);
observe('native result text bound', request('resource.s + resource.s + resource.s', tagged('map', { s: tagged('string', 'x'.repeat(30000)) })), 'RESOURCE_LIMIT');
observe('native result item bound', request('[resource.x, resource.x]', tagged('map', { x: tagged('list', Array.from({ length: 1100 }, () => tagged('null'))) })), tagged('list', [tagged('list', Array.from({ length: 1100 }, () => tagged('null'))), tagged('list', Array.from({ length: 1100 }, () => tagged('null')))]));
// The preceding bounded input expands beyond the output node budget only when
// duplicated four times, without increasing admission input size.
observe('native result expanded item budget', request('[resource.x, resource.x, resource.x, resource.x]', tagged('map', { x: tagged('list', Array.from({ length: 1100 }, () => tagged('null'))) })), 'RESOURCE_LIMIT');
await writeFile('value-results.json', JSON.stringify({ observations }, null, 2) + '\n');
console.log(`Node -> Go -> native CEL -> tagged computed result -> Node: ${observations.length} observations passed`);
