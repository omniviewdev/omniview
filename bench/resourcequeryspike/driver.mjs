// Actual Node JSON serialization -> Go admission -> native CEL -> JSON -> Node.
// No JavaScript evaluator, local query sorting, or numeric equality replacement.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const observations = [];
function request(source = 'true') {
  return { version: 'omniview.p01-spike.v1', scenario: 'cloud-bundled-pages', source, scope: { account: { kind: 'any' }, region: { kind: 'any' } }, declarations: {}, bindings: {}, pageSize: 128 };
}
function invoke(r, raw, cwd) {
  const p = spawnSync(resolve('p01-probe'), [], { cwd, input: raw ?? JSON.stringify(r), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}
function observe(name, r, expected, raw, cwd) {
  const out = invoke(r, raw, cwd);
  if (typeof expected === 'string') assert.equal(out.error?.code, expected, `${name}: ${JSON.stringify(out)}`);
  else { assert.equal(out.error, undefined, `${name}: ${JSON.stringify(out)}`); assert.deepEqual(out.names, expected, name); }
  observations.push({ name, expected, observed: out });
  return out;
}
const scalar = (kind, value) => ({ kind, value });
let r = request('resource.tags.exists(t, t.key == "env" && t.value == environment)');
r.declarations.environment = { kind: 'string' }; r.bindings.environment = scalar('string', 'prod');
observe('same-element correlation', r, ['cloud-arn']);
r.bindings.environment = scalar('string', 'dev');
observe('binding reuse does not interpolate source', r, ['cloud-ocid']);
r.bindings.environment = scalar('string', '" || true || "');
observe('malicious bound value remains data', r, []);

r = request('resource.sizeBytes == exact');
r.declarations.exact = { kind: 'int64' }; r.bindings.exact = scalar('int64', '9007199254740993');
let out = observe('exact signed integer above JS safe integer', r, ['cloud-arn']);
assert.equal(out.bindings.exact.value, '9007199254740993');
r.declarations.exact = { kind: 'uint64' }; r.bindings.exact = scalar('uint64', '18446744073709551615');
out = observe('exact unsigned range maximum', r, ['cloud-ocid']);
assert.equal(out.bindings.exact.value, '18446744073709551615');
r.declarations.exact = { kind: 'int64' }; r.bindings.exact = scalar('int64', '-9223372036854775808');
out = observe('exact signed range minimum stays data', r, []);
assert.equal(out.bindings.exact.value, '-9223372036854775808');

r = request('when == timestamp("2026-10-17T12:00:00.123456789Z")');
r.declarations.when = { kind: 'timestamp' }; r.bindings.when = scalar('timestamp', '2026-10-17T14:00:00.123456789+02:00');
out = observe('nanosecond instant transport and normalization', r, ['cloud-arn', 'cloud-ocid']);
assert.equal(out.bindings.when.value, '2026-10-17T12:00:00.123456789Z');
r.bindings.when = scalar('timestamp', '2026-10-17T12:00:00.1234567891Z');
observe('excess precision rejects rather than truncates', r, 'INVALID_REQUEST');
r.bindings.when = scalar('timestamp', '2026-10-17T12:00:00+24:00');
observe('invalid timestamp offset rejects', r, 'INVALID_REQUEST');

r = request('size(xs) == 0 && size(m) == 0 && n == null && nested["k"][0] == "雪😀" && d == 0.5');
r.declarations = { xs: { kind: 'list', element: { kind: 'uint64' } }, m: { kind: 'map', value: { kind: 'bool' } }, n: { kind: 'nullable', value: { kind: 'timestamp' } }, nested: { kind: 'map', value: { kind: 'list', element: { kind: 'string' } } }, d: { kind: 'double' } };
r.bindings = { xs: scalar('list', []), m: scalar('map', {}), n: { kind: 'null' }, nested: scalar('map', { k: scalar('list', [scalar('string', '雪😀')]) }), d: scalar('double', 0.5) };
observe('recursive typed empty nullable map list finite double', r, ['cloud-arn', 'cloud-ocid']);
r.bindings.xs = scalar('list', [scalar('string', '1')]);
observe('recursive wrong element rejects before evaluation', r, 'INVALID_REQUEST');

for (const [name, declaration, binding] of [
  ['negative zero integer', {kind:'int64'}, scalar('int64','-0')],
  ['overflow unsigned', {kind:'uint64'}, scalar('uint64','18446744073709551616')],
  ['JS numeric integer not decimal string', {kind:'int64'}, scalar('int64',9007199254740992)],
  ['unknown tag', {kind:'string'}, scalar('mystery','x')],
  ['explicit null not nullable', {kind:'string'}, {kind:'null'}],
  ['raw null scalar not default empty', {kind:'string'}, scalar('string',null)],
  ['scalar declaration child not ignored', {kind:'string',element:{kind:'int64'}}, scalar('string','x')],
]) {
  r = request(); r.declarations.p = declaration; r.bindings.p = binding;
  observe(name, r, 'INVALID_REQUEST');
}
r = request(); r.declarations.p = {kind:'string'};
observe('missing binding', r, 'INVALID_REQUEST');
r = request(); r.bindings.p = scalar('string','x');
observe('extra binding', r, 'INVALID_REQUEST');
r = request(); r.declarations.resource = {kind:'string'}; r.bindings.resource = scalar('string','x');
observe('resource name cannot be shadowed', r, 'INVALID_REQUEST');
observe('duplicate key retains evidence', {}, 'INVALID_REQUEST', '{"version":"a","version":"b"}');
observe('unknown field rejects', {...request(), principal:'forged'}, 'INVALID_REQUEST');
observe('request bytes bounded', {}, 'RESOURCE_LIMIT', ' '.repeat(65537));

r = request('has(resource.description) && resource.description == null');
observe('present null distinct from missing', r, ['cloud-arn']);
r.source = '!has(resource.description)';
observe('missing distinct from explicit null', r, ['cloud-ocid']);
r.source = 'resource.description == "x"';
observe('unguarded missing is error not false', r, 'INVALID_REQUEST');
r = request('resource'); observe('nonboolean is not truthy membership', r, 'INVALID_REQUEST');
r = request('resource.tags.exists(t, t.key == "env")'); r.costLimit = 1;
observe('native CEL cost limit', r, 'RESOURCE_LIMIT');
r = request(); r.mode = 'follow'; observe('no fake query lease', r, 'UNSUPPORTED');
r = request(); r.scope.region = {kind:'oneOf',values:[]}; observe('empty oneOf never all', r, []);
r = request(); delete r.scope.region; observe('missing scope never silently widens', r, 'INVALID_REQUEST');

r = request('true'); r.orderPath = ['description']; r.pageSize = 1;
observe('global missing before null and page after sort', r, ['cloud-ocid']);
r.offset = 1; observe('second global page is explicit null row', r, ['cloud-arn']);
r = request('resource.tags.exists(t, t.key == "env" && t.value == "dev")'); r.pageSize = 1;
observe('residual before final limit', r, ['cloud-ocid']);
r.candidates = ['cloud-ocid','cloud-arn']; observe('safe candidate superset agrees', r, ['cloud-ocid']);
r.candidates = ['cloud-arn']; observe('unsafe pre-limit counterexample loses required row', r, []);

for (const [kind, expected] of [['equal',[]], ['not',['cloud-arn','cloud-ocid']], ['notEqualPresent',[]]]) {
  r = request(''); r.builder = {kind,path:['description'],parameter:'p'}; r.declarations.p = {kind:'string'}; r.bindings.p = scalar('string','prod');
  observe(`builder ${kind} missing/null semantics`,r,expected);
}
r = request(''); r.builder = {kind:'advanced',path:['description']}; observe('unsupported builder is not lossy rewritten',r,'UNSUPPORTED');
r = request('resource.tags.all(t, t.key != "blocked")'); r.text = {fields:[['id']],term:'ocid1'};
observe('text AND predicate AND scope',r,['cloud-ocid']);
r.scope.region = {kind:'oneOf',values:['eu-central-1']}; observe('text does not override scope',r,[]);

r = request('("quoted.key/雪" in resource.labels) && resource.labels["quoted.key/雪"] == p');
r.scenario = 'container-absent-snapshot'; r.scope = {engine:{kind:'any'}}; r.declarations.p = {kind:'string'}; r.bindings.p = scalar('string',"x' || true || '");
out = observe('absent-schema quoted map key and injected binding',r,['container-a']);
assert.equal(out.rows[0].incarnation,'created:2026-10-17/a');
r = request('resource.name == "db"'); r.scenario = 'hypervisor-absent-vms'; r.scope = {node:{kind:'oneOf',values:['node/a::1']}};
out = observe('absent-schema node-local VM identity and scope',r,['vm-a']);
assert.equal(out.rows[0].incarnation,undefined);
assert.equal(out.rows[0].sourceRevision,undefined);

r = {version:'omniview.p01-spike.v1',draft:{source:'"雪😀" == "雪😀" && resource.labels.',cursor:Buffer.byteLength('"雪😀" == "雪😀" && resource.labels.'),documentRevision:'doc1',environmentRevision:'env1',declarations:{}}};
out = invoke(r); assert.equal(out.error,undefined); assert.equal(out.draft.valid,false); assert.equal(out.draft.context,'resource.labels'); assert.equal(out.draft.unit,'utf8-byte');
observations.push({name:'useful partial draft retains native parse failure and host cursor context',observed:out});

r = request('p'); r.declarations.p = {kind:'nullable',value:{kind:'bool'}}; r.bindings.p = scalar('bool',true);
observe('checked dyn result actual Boolean true admitted',r,['cloud-arn','cloud-ocid']);
r.bindings.p = scalar('bool',false); observe('checked dyn result actual Boolean false admitted',r,[]);
r.bindings.p = {kind:'null'}; observe('checked dyn null not truthy or false',r,'INVALID_REQUEST');
r = request('1'); observe('known nonboolean type rejected',r,'INVALID_REQUEST');
r = request('true'); r.text = {fields:[['id'],['description']],term:'arn:'};
observe('multi-field ANY includes string despite known null',r,['cloud-arn']);
r.text.term = 'ocid1'; observe('multi-field ANY includes string despite known absent',r,['cloud-ocid']);
r.incompleteRepresentation = true; observe('ANY cannot mask unavailable representation',r,'UNSUPPORTED');
r.incompleteRepresentation = false; r.text.fields = [];
observe('nonempty text empty field set invalid',r,'INVALID_REQUEST');
r.text.term = ''; observe('empty text empty fields explicit unrestricted text',r,['cloud-arn','cloud-ocid']);
const diagnosticSource = '"雪😀é" == "雪😀é" && absentParameter';
r = {version:'omniview.p01-spike.v1',draft:{source:diagnosticSource,cursor:Buffer.byteLength(diagnosticSource),documentRevision:'doc2',environmentRevision:'env1',declarations:{}}};
out = invoke(r); assert.equal(out.error,undefined);
const prefix = diagnosticSource.slice(0,diagnosticSource.indexOf('absentParameter'));
assert.ok(out.draft.diagnostics.some(d=>d.start === Buffer.byteLength(prefix) && d.end === Buffer.byteLength(prefix)+1 && d.unit === 'utf8-byte'));
assert.notEqual(Buffer.byteLength(prefix),prefix.length);
assert.equal(out.draft.documentRevision,'doc2');
assert.equal(out.draft.environmentRevision,'env1');
observations.push({name:'actual native CEL diagnostic codepoints translated after supplementary and combining characters',observed:out});
r.draft.source = 'minimum == 1'; r.draft.cursor = 12; r.draft.declarations = {minimum:{kind:'int64'}};
out = invoke(r); assert.equal(out.error,undefined); assert.deepEqual(out.draft.diagnostics,[]);
observations.push({name:'authoring checks declared int without binding values',observed:out});
r.draft.declarations.minimum = {kind:'string'}; r.draft.environmentRevision = 'env2';
out = invoke(r); assert.equal(out.error,undefined); assert.ok(out.draft.diagnostics.length > 0); assert.equal(out.draft.environmentRevision,'env2');
observations.push({name:'declaration type change changes actual diagnostics and stale identity',observed:out});

r = request('p == "y"'); r.declarations.p = {kind:'string'}; r.bindings.p = {kind:'string',value:'x',Value:'y'};
observe('case alias cannot overwrite actual execution binding',r,'INVALID_REQUEST');
r = request('true'); r.Version = r.version;
observe('root DTO member names are exact',r,'INVALID_REQUEST');
r = request('true'); r.declarations.p = {Kind:'string'}; r.bindings.p = scalar('string','x');
observe('declaration DTO member names are exact',r,'INVALID_REQUEST');
for (const [name,badString] of [['high surrogate','\ud800'],['low surrogate','\udfff'],['high plus nonlow','\ud800A']]) {
  r = request('p == "�"'); r.declarations.p = {kind:'string'}; r.bindings.p = scalar('string',badString);
  observe(`unpaired ${name} rejects before native value coercion`,r,'INVALID_REQUEST');
}
r = request(); r.declarations['\ud800'] = {kind:'string'}; r.bindings['\ud800'] = scalar('string','x');
observe('unpaired surrogate object key rejects',r,'INVALID_REQUEST');
for (const [name,input,want,source] of [
  ['valid surrogate pair','😀','😀','p == "😀"'],
  ['literal replacement character','�','�','p == "�"'],
  ['escaped backslash text',String.raw`\ud800`,String.raw`\ud800`,String.raw`p == "\\ud800"`],
]) {
  r = request(source); r.declarations.p = {kind:'string'}; r.bindings.p = scalar('string',input);
  out = observe(`${name} remains exact data`,r,['cloud-arn','cloud-ocid']); assert.equal(out.bindings.p.value,want);
}
r = request('size(p) == 3'); r.declarations.p = {kind:'map',value:{kind:'string'}};
r.bindings.p = scalar('map',{'Value':scalar('string','upper'),'value':scalar('string','lower'),'雪😀':scalar('string','unicode')});
out = observe('arbitrary map key case and Unicode preserved',r,['cloud-arn','cloud-ocid']);
assert.deepEqual(Object.keys(out.bindings.p.value).sort(),['Value','value','雪😀'].sort());
r.bindings.p.value.Value = {kind:'string',value:'x',Value:'y'};
observe('nested tagged DTO rejects aliases within arbitrary-key map',r,'INVALID_REQUEST');
r = request('true');
for (let i=0;i<128;i++) {r.declarations[`p${i}`]={kind:'bool'};r.bindings[`p${i}`]=scalar('bool',true);}
observe('128 valid matching declarations execute',r,['cloud-arn','cloud-ocid']);
r.declarations.p128={kind:'bool'};r.bindings.p128=scalar('bool',true);
observe('129 matching declarations are a resource limit',r,'RESOURCE_LIMIT');
r = {version:'omniview.p01-spike.v1',draft:{source:'resource.labels.env',cursor:18,documentRevision:'mid1',environmentRevision:'env1',declarations:{}}};
out = invoke(r); assert.equal(out.error,undefined); assert.equal(out.draft.start,16); assert.equal(out.draft.end,19);
assert.equal(r.draft.source.slice(0,out.draft.start)+'environment'+r.draft.source.slice(out.draft.end),'resource.labels.environment');
observations.push({name:'midtoken member replacement consumes identifier suffix',observed:out});

for (const kind of ['equal','not','notEqualPresent']) {
  for (const parameter of ['true','false','null','undeclared']) {
    r = request(''); r.builder = {kind,path:['description'],parameter};
    observe(`builder ${kind} rejects nonparameter ${parameter}`,r,'INVALID_REQUEST');
  }
}
r = request(''); r.builder = {kind:'equal',path:['id'],parameter:'needle'};
r.declarations.needle = {kind:'string'}; r.bindings.needle = scalar('string','ocid1.instance.fixture.us-west-2.a:b/c%25');
observe('builder declared parameter selects exact native member',r,['cloud-ocid']);

// Same target/address, different opaque incarnation; caller arrival, name and
// source revision must not decide final page membership. The subprocess reads a
// private derived fixture, never replacing the provenance-checked P44 corpus.
const tieCorpus = JSON.parse(await readFile('corpus.json','utf8'));
const base = tieCorpus.Records.find(record => record.Name === 'cloud-arn');
const a = {...base,Name:'z-name',Incarnation:'a-token',Revision:'z-revision'};
const b = {...base,Name:'a-name',Incarnation:'z-token',Revision:'a-revision'};
const absent = {...base,Name:'middle-name'};
delete absent.Incarnation;
const tieScenario = tieCorpus.Scenarios.find(scenario => scenario.Name === 'cloud-bundled-pages');
tieScenario.Pages = [{Records:['z-name','a-name','middle-name']}];
const tieDirectory = await mkdtemp(join(tmpdir(),'p01-incarnation-pages-'));
try {
  for (const [permutation,records] of [[b,a,absent],[a,absent,b]].entries()) {
    tieCorpus.Records = records;
    await writeFile(join(tieDirectory,'corpus.json'),JSON.stringify(tieCorpus));
    for (const [offset,want] of ['middle-name','z-name','a-name'].entries()) {
      r = request(); r.pageSize = 1; r.offset = offset;
      observe(`incarnation page ${offset} independent of arrival ${permutation}`,r,[want],undefined,tieDirectory);
    }
  }
} finally {
  await rm(tieDirectory,{recursive:true});
}

const unreachable = [true,false,false,false,false,true,false];
const nestedCases = [
  ['missing-ancestor',{},unreachable],
  ['null-ancestor',{a:null},unreachable],
  ['string-ancestor',{a:'x'},unreachable],
  ['integer-ancestor',{a:7},unreachable],
  ['boolean-ancestor',{a:false},unreachable],
  ['empty-list-ancestor',{a:[]},unreachable],
  ['list-containing-member-name',{a:['b']},unreachable],
  ['inner-string-ancestor',{a:{b:'x'}},unreachable],
  ['inner-list-containing-leaf-name',{a:{b:['leaf']}},unreachable],
  ['missing-inner-ancestor',{a:{}},unreachable],
  ['null-inner-ancestor',{a:{b:null}},unreachable],
  ['missing-leaf',{a:{b:{}}},unreachable],
  ['null-leaf',{a:{b:{leaf:null}}},[false,true,true,false,false,true,false]],
  ['matching-string-leaf',{a:{b:{leaf:'wanted'}}},[false,true,false,true,true,false,false]],
  ['different-string-leaf',{a:{b:{leaf:'other'}}},[false,true,false,true,false,true,true]],
  ['list-leaf',{a:{b:{leaf:['wanted']}}},[false,true,false,true,true,false,false],{kind:'list',element:{kind:'string'}},scalar('list',[scalar('string','wanted')])],
  ['empty-list-leaf',{a:{b:{leaf:[]}}},[false,true,false,true,true,false,false],{kind:'list',element:{kind:'string'}},scalar('list',[])],
  ['map-leaf',{a:{b:{leaf:{k:'wanted'}}}},[false,true,false,true,true,false,false],{kind:'map',value:{kind:'string'}},scalar('map',{k:scalar('string','wanted')})],
  ['injection-shaped-bound-value',{a:{b:{leaf:'" || true || "'}}},[false,true,false,true,true,false,false],{kind:'string'},scalar('string','" || true || "')],
];
const nestedKinds = ['absent','present','null','nonNull','equal','not','notEqualPresent'];
const nestedCorpus = {...tieCorpus,Records:[{...base}]};
tieScenario.Pages = [{Records:['cloud-arn']}];
const nestedDirectory = await mkdtemp(join(tmpdir(),'p01-nested-ancestors-'));
try {
  for (const [name,body,want,declaration = {kind:'string'},binding = scalar('string','wanted')] of nestedCases) {
    nestedCorpus.Records[0].Body = body;
    await writeFile(join(nestedDirectory,'corpus.json'),JSON.stringify(nestedCorpus));
    for (const [i,kind] of nestedKinds.entries()) {
      r = request(''); r.builder = {kind,path:['a','b','leaf']};
      if (['equal','not','notEqualPresent'].includes(kind)) {
        r.builder.parameter = 'needle'; r.declarations.needle = declaration; r.bindings.needle = binding;
      }
      observe(`nested builder ${name} ${kind}`,r,want[i] ? ['cloud-arn'] : [],undefined,nestedDirectory);
    }
  }
  for (const name of ['type','map','list','dyn','bool']) {
    r = request(''); r.builder = {kind:'present',path:['a','b','leaf']};
    r.declarations[name] = {kind:'string'}; r.bindings[name] = scalar('string','map');
    observe(`builder guard builtin ${name} cannot be shadowed`,r,'INVALID_REQUEST',undefined,nestedDirectory);
  }
} finally {
  await rm(nestedDirectory,{recursive:true});
}

const corpus = await readFile('corpus.json');
const provenance = JSON.parse(await readFile('corpus-provenance.json','utf8'));
assert.equal(createHash('sha256').update(corpus).digest('hex'),provenance.corpusSHA256);
const report = { experimentalOnly:true, numericProductionGate:'BLOCKED; no mixed-double or optimized numeric acceptance claimed', selectedCEL:'cel.dev/cel-go v0.32.0 UNSAFE EXPERIMENTAL', node:process.version, corpus:provenance, observations:observations.length, results:observations };
await writeFile('results.json',JSON.stringify(report,null,2)+'\n');
console.log(`Node -> Go -> native CEL -> Node: ${observations.length} independently expected observations passed; numeric production gate BLOCKED`);
