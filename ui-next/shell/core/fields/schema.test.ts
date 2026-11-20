import { describe, expect, it } from 'vitest';
import { MIGRATIONS, compileSchema, type CompiledField, type CompiledSchema } from './schema';
import { FIELD_KINDS, LIMITS, SCHEMA_VERSION, type ProblemCode } from './types';

// A schema is plain data a plugin or the host writes (no functions). It is compiled once: read defensively (it comes from a plugin, possibly a newer one), normalised, frozen, and
// indexed by what its conditions read. A schema that cannot be read at all is `ok: false`; one that can is read as far as it goes, and what was left out is a problem, never a crash.

function compiled(raw: unknown, options?: Parameters<typeof compileSchema>[1]): { readonly schema: CompiledSchema; readonly problems: readonly ProblemCode[] } {
  const result = compileSchema(raw, options);
  if (!result.ok) {
    throw new Error(`not compiled: ${result.reason}: ${result.detail}`);
  }

  return { schema: result.schema, problems: result.problems.map((problem) => problem.code) };
}

function one(spec: Record<string, unknown>, others: ReadonlyArray<Record<string, unknown>> = []): { readonly field: CompiledField; readonly problems: readonly ProblemCode[]; readonly schema: CompiledSchema } {
  const { schema, problems } = compiled({ sections: [{ fields: [{ id: 'f', kind: 'text', ...spec }, ...others] }] });
  const field = schema.index.get(typeof spec.id === 'string' ? spec.id : 'f');
  if (field === undefined) {
    throw new Error('the field was not compiled');
  }

  return { field, problems, schema };
}

describe('a form as data', () => {
  it('compiles sections and fields in the order written, with a flat list and a lookup by id', () => {
    const { schema, problems } = compiled({
      id: 'plugin:demo/settings',
      sections: [
        { id: 'general', label: 'General', help: 'The basics.', fields: [{ id: 'name', kind: 'text', label: 'Name' }, { id: 'port', kind: 'number' }] },
        { fields: [{ id: 'on', kind: 'boolean', label: 'Enabled', help: 'Turns it on.' }] },
      ],
    });

    expect(problems).toEqual([]);
    expect(schema.id).toBe('plugin:demo/settings');
    expect(schema.version).toBe(SCHEMA_VERSION);
    expect(schema.sections.map((section) => [section.id, section.label, section.fields.map((field) => field.id)])).toEqual([
      ['general', 'General', ['name', 'port']],
      ['section-2', '', ['on']],
    ]);
    expect(schema.fields.map((field) => [field.id, field.index, field.section])).toEqual([['name', 0, 'general'], ['port', 1, 'general'], ['on', 2, 'section-2']]);
    expect(schema.index.get('port')).toBe(schema.fields[1]);
    expect(schema.fields[2]?.help).toBe('Turns it on.');
  });

  it('names a field by its id when it has no label, and a form by "form" when it has no id', () => {
    const { schema } = compiled({ sections: [{ fields: [{ id: 'configFiles', kind: 'list' }] }] });
    expect(schema.fields[0]?.label).toBe('configFiles');
    expect(schema.id).toBe('form');
  });

  it('is the same whether it comes from a literal or through JSON: it is plain data', () => {
    const raw = { id: 'x', sections: [{ fields: [{ id: 'a', kind: 'select', default: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], visibleWhen: { field: 'a', equals: 'a' } }] }] };
    const viaJson = compiled(JSON.parse(JSON.stringify(raw)) as unknown).schema;
    const direct = compiled(raw).schema;
    expect(viaJson.fields.map((field) => [field.id, field.kind, field.default, field.options])).toEqual(direct.fields.map((field) => [field.id, field.kind, field.default, field.options]));
  });

  it('is frozen, so a view or a plugin that keeps a reference cannot change it', () => {
    const { schema } = compiled({ sections: [{ fields: [{ id: 'a', kind: 'select', options: [{ value: 'x', label: 'X' }], constraints: { required: true, min: 1 } }] }] });
    const field = schema.fields[0];
    for (const value of [schema, schema.sections, schema.fields, schema.sections[0], field, field.constraints, field.options, field.options?.[0]]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('knows nothing of the plugin that wrote it, and is not troubled by members it does not know', () => {
    const { schema, problems } = compiled({ sections: [{ fields: [{ id: 'a', kind: 'text', plugin: 'acme', somethingNew: { nested: true } }] }], futureMember: 1 });
    expect(problems).toEqual([]);
    expect(schema.fields[0]?.label).toBe('a');
  });
});

describe('the closed list of kinds', () => {
  it('has ten kinds, and every one compiles as itself', () => {
    expect(FIELD_KINDS).toEqual(['text', 'number', 'boolean', 'select', 'multiselect', 'path', 'url', 'color', 'secret', 'list']);
    for (const kind of FIELD_KINDS) {
      expect(one({ kind }).field.kind).toBe(kind);
    }
  });

  it('turns a kind from a newer schema into a read-only entry that says so, and keeps what it can say about it', () => {
    const { field, problems } = one({ id: 'f', kind: 'duration', label: 'Timeout', help: 'How long.', default: '5s', constraints: { min: 1 }, visibleWhen: true });
    expect(field.kind).toBe('unsupported');
    expect(field.rawKind).toBe('duration');
    expect(field.label).toBe('Timeout');
    expect(field.help).toBe('How long.');
    expect(field.readonly).toBe(true);
    expect(field.default).toBeUndefined();
    expect(field.options).toBeUndefined();
    expect(field.validate).toBeUndefined();
    expect(problems).toEqual(['unsupported-kind']);
  });

  it('does the same for a kind that is missing, not a text, or not printable, and cleans what it quotes', () => {
    for (const kind of [undefined, null, 4, {}, ['text'], '', '\u001b[31mduration\u001b[0m']) {
      const { field } = one({ kind });
      expect(field.kind).toBe('unsupported');
      expect(field.rawKind).not.toContain('\u001b');
    }

    expect(one({ kind: 'x'.repeat(500) }).field.rawKind.length).toBeLessThanOrEqual(64);
  });

  it('keeps an unsupported field hidden when its own condition hides it, and a sensitive one never shows a value', () => {
    const { field } = one({ kind: 'duration', sensitive: true, visibleWhen: false });
    expect(field.visible?.node).toEqual({ t: 'const', v: false, reason: '' });
    expect(field.sensitive).toBe(true);
  });

  it('is not troubled by members it does not know, on a field, a section, a constraint or the form', () => {
    const { schema, problems } = compiled({ version: 1, extra: { a: 1 }, sections: [{ id: 's', theme: 'x', fields: [{ id: 'a', kind: 'text', accent: 'red', constraints: { required: true, soon: 1 } }] }] });
    expect(problems).toEqual([]);
    expect(schema.fields[0]?.constraints.required).toBe(true);
  });
});

describe('ids', () => {
  it('may contain dots and anything else printable: a plugin\'s ids are opaque', () => {
    const { schema, problems } = compiled({ sections: [{ fields: [{ id: 'editor.fontSize', kind: 'number' }, { id: 'a b/c:d', kind: 'text' }] }] });
    expect(problems).toEqual([]);
    expect(schema.fields.map((field) => field.id)).toEqual(['editor.fontSize', 'a b/c:d']);
  });

  it('keeps the first of two fields with one id, and says so', () => {
    const { schema, problems } = compiled({ sections: [{ fields: [{ id: 'a', kind: 'text', label: 'First' }, { id: 'a', kind: 'number', label: 'Second' }] }] });
    expect(schema.fields.map((field) => field.label)).toEqual(['First']);
    expect(problems).toEqual(['duplicate-id']);
  });

  it('drops a field with no usable id and a field named like a member of every object', () => {
    const { schema, problems } = compiled({ sections: [{ fields: [{ kind: 'text' }, { id: '', kind: 'text' }, { id: 4, kind: 'text' }, { id: 'x'.repeat(LIMITS.id + 1), kind: 'text' }, { id: 'a\u0000b', kind: 'text' }, { id: '__proto__', kind: 'text' }, { id: 'constructor', kind: 'text' }, { id: 'prototype', kind: 'text' }, { id: 'ok', kind: 'text' }] }] });
    expect(schema.fields.map((field) => field.id)).toEqual(['ok']);
    expect(problems.filter((code) => code === 'bad-field')).toHaveLength(5);
    expect(problems.filter((code) => code === 'forbidden-id')).toHaveLength(3);
  });

  it('keeps a limit on fields and says what it did', () => {
    const fields = Array.from({ length: LIMITS.fields + 5 }, (_, index) => ({ id: `f${String(index)}`, kind: 'text' }));
    const { schema, problems } = compiled({ sections: [{ fields }] });
    expect(schema.fields).toHaveLength(LIMITS.fields);
    expect(problems).toEqual(['too-many-fields']);
  });
});

describe('sections', () => {
  it('drops what is not a section, and reads a section with no list of fields as an empty one', () => {
    const { schema, problems } = compiled({ sections: [null, 4, 'x', { id: 'a', fields: 'no' }, { id: 'b', fields: [{ id: 'f', kind: 'text' }] }] });
    expect(schema.sections.map((section) => [section.id, section.fields.length])).toEqual([['a', 0], ['b', 1]]);
    expect(problems.filter((code) => code === 'bad-section')).toHaveLength(4);
  });

  it('makes a second section with the same id its own', () => {
    const { schema, problems } = compiled({ sections: [{ id: 'a', fields: [] }, { id: 'a', fields: [] }, { id: 'a', fields: [] }] });
    expect(new Set(schema.sections.map((section) => section.id)).size).toBe(3);
    expect(problems.filter((code) => code === 'bad-section')).toHaveLength(2);
  });

  it('carries collapsed and a condition, and gives each of its fields its section', () => {
    const { schema } = compiled({ sections: [{ id: 'adv', label: 'Advanced', collapsed: true, visibleWhen: { ctx: 'developer', equals: true }, fields: [{ id: 'a', kind: 'text' }] }] });
    expect(schema.sections[0]?.collapsed).toBe(true);
    expect(schema.sections[0]?.visible?.ctx).toEqual(['developer']);
    expect(schema.fields[0]?.section).toBe('adv');
  });
});

describe('text from a plugin', () => {
  it('is cleaned and bounded: label, help, hint, placeholder, unit and keywords', () => {
    const { field } = one({
      label: `\u001b[1mName\u001b[0m\n${'x'.repeat(500)}`,
      help: 'a\u202Eb  c',
      hint: 'y'.repeat(500),
      placeholder: 'z'.repeat(500),
      unit: 'seconds-and-seconds-and-seconds',
      keywords: [...Array.from({ length: 30 }, (_, index) => `word${String(index)}`), 4, null],
    });
    expect(field.label.startsWith('Name xxx')).toBe(true);
    expect([...field.label].length).toBeLessThanOrEqual(LIMITS.label);
    expect(field.help).toBe('ab c');
    expect([...field.hint].length).toBeLessThanOrEqual(LIMITS.hint);
    expect([...field.placeholder].length).toBeLessThanOrEqual(LIMITS.hint);
    expect(field.unit.length).toBeLessThanOrEqual(16);
    expect(field.keywords).toHaveLength(LIMITS.keywords);
  });
});

describe('defaults', () => {
  it('are the kind\'s empty value when the schema gives none', () => {
    const empties = Object.fromEntries(FIELD_KINDS.map((kind) => [kind, one({ kind }).field.default]));
    expect(empties).toEqual({ text: '', number: undefined, boolean: false, select: undefined, multiselect: [], path: '', url: '', color: '', secret: undefined, list: [] });
  });

  it('are kept when they fit the kind, and are a frozen copy', () => {
    const list = ['a', 'b'];
    const { field } = one({ kind: 'list', default: list });
    expect(field.default).toEqual(['a', 'b']);
    expect(field.default).not.toBe(list);
    expect(Object.isFrozen(field.default)).toBe(true);
    expect(one({ kind: 'number', default: 9090 }).field.default).toBe(9090);
    expect(one({ kind: 'boolean', default: true }).field.default).toBe(true);
    expect(one({ kind: 'select', default: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }).field.default).toBe('b');
    expect(one({ kind: 'multiselect', default: ['a'], options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }).field.default).toEqual(['a']);
  });

  it('are dropped, with a problem, when they do not fit: the wrong type, a choice that is not offered, a function', () => {
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { kind: 'number', default: 'x' },
      { kind: 'number', default: Number.NaN },
      { kind: 'boolean', default: 'yes' },
      { kind: 'text', default: 4 },
      { kind: 'list', default: [1, 2] },
      { kind: 'list', default: 'a' },
      { kind: 'select', default: 'z', options: [{ value: 'a', label: 'A' }] },
      { kind: 'multiselect', default: ['a', 'z'], options: [{ value: 'a', label: 'A' }] },
      { kind: 'text', default: () => 'x' },
      { kind: 'text', default: { a: 1 } },
    ];
    for (const spec of cases) {
      const { field, problems } = one(spec);
      expect(problems, JSON.stringify(spec)).toEqual(['bad-default']);
      expect(field.default).toEqual(one({ kind: spec.kind }).field.default);
    }
  });

  it('are never kept for a secret, and a secret is sensitive whatever the schema says', () => {
    const { field, problems } = one({ kind: 'secret', default: 'hunter2', sensitive: false });
    expect(field.default).toBeUndefined();
    expect(field.sensitive).toBe(true);
    expect(problems).toEqual(['secret-rule']);
    const sensitive = one({ kind: 'text', sensitive: true, default: 'sk-live' });
    expect(sensitive.field.default).toBeUndefined();
    expect(sensitive.field.sensitive).toBe(true);
    expect(sensitive.problems).toEqual(['secret-rule']);
  });
});

describe('constraints', () => {
  it('are read per kind, and a bound that is not a number is dropped with a problem', () => {
    const { field, problems } = one({ kind: 'number', constraints: { required: true, min: 1, max: 300, step: 5, integer: true } });
    expect(problems).toEqual([]);
    expect(field.constraints).toMatchObject({ required: true, min: 1, max: 300, step: 5, integer: true });
    expect(field.required).toBe(true);

    const bad = one({ kind: 'number', constraints: { min: 'low', max: Number.POSITIVE_INFINITY, step: 0, integer: 'yes' } });
    expect(bad.problems).toEqual(['bad-constraint', 'bad-constraint', 'bad-constraint', 'bad-constraint']);
    expect(bad.field.constraints.min).toBeUndefined();
    expect(bad.field.constraints.max).toBeUndefined();
    expect(bad.field.constraints.step).toBeUndefined();
  });

  it('drops both bounds when the minimum is above the maximum', () => {
    for (const [kind, constraints] of [['number', { min: 5, max: 1 }], ['text', { minLength: 5, maxLength: 1 }], ['list', { minItems: 5, maxItems: 1 }]] as const) {
      const { field, problems } = one({ kind, constraints });
      expect(problems).toEqual(['bad-constraint']);
      expect(Object.values(field.constraints).filter((value) => typeof value === 'number')).toEqual([]);
    }
  });

  it('compile a pattern that is a regular expression and drop one that is not, or too long', () => {
    const { field } = one({ kind: 'text', constraints: { pattern: '[a-z]+' } });
    expect(field.constraints.pattern?.test('abc')).toBe(true);
    expect(field.constraints.pattern?.test('abc1')).toBe(false);
    expect(field.constraints.pattern?.test('1abc')).toBe(false);
    for (const pattern of ['([', 'x'.repeat(LIMITS.pattern + 1), 4]) {
      const bad = one({ kind: 'text', constraints: { pattern } });
      expect(bad.problems).toEqual(['bad-constraint']);
      expect(bad.field.constraints.pattern).toBeUndefined();
    }
  });

  it('read allowed characters as a named class or as a bracket class, one character at a time', () => {
    const named = one({ kind: 'text', constraints: { allowedChars: 'hostport' } }).field.constraints.allowed;
    expect(['a', '1', '.', ':', '-'].every((char) => named?.test(char))).toBe(true);
    expect(['/', ' ', '_'].some((char) => named?.test(char))).toBe(false);
    const custom = one({ kind: 'text', constraints: { allowedChars: '[a-c]' } }).field.constraints.allowed;
    expect([custom?.test('b'), custom?.test('d'), custom?.test('ab')]).toEqual([true, false, false]);
    for (const allowedChars of ['nope', '[a-', '(a)', '[a-z]*', 4]) {
      const bad = one({ kind: 'text', constraints: { allowedChars } });
      expect(bad.problems).toEqual(['bad-constraint']);
      expect(bad.field.constraints.allowed).toBeUndefined();
    }
  });

  it('keep a format only for the kind it is for, and a list\'s item kind, a path\'s kind and a url\'s schemes', () => {
    expect(one({ kind: 'text', constraints: { format: 'datetime' } }).field.constraints.format).toBe('datetime');
    expect(one({ kind: 'text', constraints: { format: 'iban' } }).problems).toEqual(['bad-constraint']);
    expect(one({ kind: 'list', constraints: { item: 'path' } }).field.constraints.item).toBe('path');
    expect(one({ kind: 'list' }).field.constraints.item).toBe('text');
    expect(one({ kind: 'path', constraints: { pathKind: 'directory', absolute: true, extensions: ['.yaml', 'yml'] } }).field.constraints).toMatchObject({ pathKind: 'directory', absolute: true, extensions: ['.yaml', 'yml'] });
    expect(one({ kind: 'url' }).field.constraints.schemes).toEqual(['http', 'https']);
    expect(one({ kind: 'url', constraints: { schemes: ['unix', 'tcp'] } }).field.constraints.schemes).toEqual(['unix', 'tcp']);
  });

  it('say sameAs only of a field that exists, is not itself, and is a secret exactly when this one is', () => {
    const other = { id: 'other', kind: 'text' };
    expect(one({ constraints: { sameAs: 'other' } }, [other]).field.constraints.sameAs).toBe('other');
    for (const sameAs of ['missing', 'f']) {
      const bad = one({ constraints: { sameAs } }, [other]);
      expect(bad.problems).toEqual(['bad-constraint']);
      expect(bad.field.constraints.sameAs).toBeUndefined();
    }

    const secret = { id: 'secret', kind: 'secret' };
    expect(one({ kind: 'secret', id: 'again', constraints: { sameAs: 'secret' } }, [secret]).field.constraints.sameAs).toBe('secret');
    const mixed = one({ kind: 'secret', id: 'again', constraints: { sameAs: 'other' } }, [other]);
    expect(mixed.problems).toEqual(['secret-rule']);
    expect(mixed.field.constraints.sameAs).toBeUndefined();
    const probe = one({ constraints: { sameAs: 'secret' } }, [secret]);
    expect(probe.problems).toEqual(['secret-rule']);
  });

  it('cut a message a plugin wrote to the lane\'s 80 characters, and ignore a code that is not one', () => {
    const { field } = one({ kind: 'text', constraints: { messages: { pattern: `Not a valid name. ${'Use lowercase letters. '.repeat(10)}`, required: 'Name is needed.', nonsense: 'x' } } });
    expect([...field.constraints.messages.pattern!].length).toBeLessThanOrEqual(LIMITS.message);
    expect(field.constraints.messages.required).toBe('Name is needed.');
    expect(Object.keys(field.constraints.messages).sort()).toEqual(['pattern', 'required']);
  });
});

describe('options', () => {
  it('are a list of values with labels, normalised: a label defaults to the value, a repeated value and a value that is not a scalar are dropped', () => {
    const { field, problems } = one({
      kind: 'select',
      options: [{ value: 'a', label: 'Alpha', description: 'The first.' }, { value: 'b' }, { value: 'a', label: 'Again' }, { value: { x: 1 }, label: 'Object' }, { value: 3, label: 'Three', disabled: 'Not yet.' }, 'c', null],
    });
    expect(field.options).toEqual([
      { value: 'a', label: 'Alpha', description: 'The first.' },
      { value: 'b', label: 'b' },
      { value: 3, label: 'Three', disabled: 'Not yet.' },
    ]);
    expect(problems.filter((code) => code === 'bad-options').length).toBeGreaterThanOrEqual(3);
  });

  it('have a limit, and say so', () => {
    const options = Array.from({ length: LIMITS.options + 3 }, (_, index) => ({ value: `v${String(index)}`, label: `V${String(index)}` }));
    const { field, problems } = one({ kind: 'multiselect', options });
    expect(field.options).toHaveLength(LIMITS.options);
    expect(problems).toEqual(['bad-options']);
  });

  it('may come from a provider the host registers by name, which has a bounded limit', () => {
    const { field, problems } = one({ kind: 'select', options: { provider: 'regions', params: { scope: 'cluster' }, limit: 25 } });
    expect(problems).toEqual([]);
    expect(field.options).toBeUndefined();
    expect(field.provider).toEqual({ name: 'regions', params: { scope: 'cluster' }, limit: 25 });
    expect(one({ kind: 'select', options: { provider: 'p', limit: 100_000 } }).field.provider?.limit).toBe(LIMITS.providerRows);
    expect(one({ kind: 'select', options: { provider: 'p' } }).field.provider?.limit).toBe(50);
    for (const provider of ['', 'has space', 4, null, 'x'.repeat(100)]) {
      const bad = one({ kind: 'select', options: { provider } });
      expect(bad.problems).toEqual(['bad-options']);
      expect(bad.field.provider).toBeUndefined();
    }
  });

  it('mean nothing to a kind that does not choose, and a default is checked against static options only', () => {
    const { field, problems } = one({ kind: 'text', options: [{ value: 'a', label: 'A' }] });
    expect(field.options).toBeUndefined();
    expect(problems).toEqual([]);
    const large = one({ kind: 'select', default: 'anything', options: { provider: 'p' } });
    expect(large.field.default).toBe('anything');
    expect(large.problems).toEqual([]);
  });
});

describe('the host\'s own check', () => {
  it('is a validator named by the schema: when it runs, how long it waits, what it depends on', () => {
    const { field, problems } = one({ kind: 'path', validate: { remote: 'executable', on: 'change', debounce: 250, timeout: 5000, dependsOn: ['other'], checking: 'Running go version…' } }, [{ id: 'other', kind: 'text' }]);
    expect(problems).toEqual([]);
    expect(field.validate).toEqual({ remote: 'executable', on: 'change', debounce: 250, timeout: 5000, dependsOn: ['other'], checking: 'Running go version…' });
    expect(one({ kind: 'path', validate: { remote: 'executable' } }).field.validate).toMatchObject({ remote: 'executable', on: 'commit', dependsOn: [] });
  });

  it('is dropped, with a problem, when it has no usable name, and its odd members are dropped or clamped', () => {
    for (const validate of [{}, { remote: '' }, { remote: 4 }, { remote: 'has space' }, 'executable']) {
      const { field, problems } = one({ validate });
      expect(field.validate).toBeUndefined();
      expect(problems).toEqual(['bad-validate']);
    }

    const { field } = one({ validate: { remote: 'v', on: 'always', debounce: -5, timeout: 1e9, dependsOn: ['missing', 4] } });
    expect(field.validate).toMatchObject({ remote: 'v', on: 'commit', dependsOn: [] });
    expect(field.validate?.debounce).toBeGreaterThanOrEqual(0);
    expect(field.validate?.timeout).toBeLessThanOrEqual(60_000);
  });

  it('is never kept for a sensitive field: a secret is handed to nothing but the submit callback', () => {
    const { field, problems } = one({ kind: 'secret', validate: { remote: 'token-check' } });
    expect(field.validate).toBeUndefined();
    expect(problems).toEqual(['secret-rule']);
    expect(one({ kind: 'text', sensitive: true, validate: { remote: 'x' } }).field.validate).toBeUndefined();
  });

  it('reads null as nothing, for every optional member: that is how a Go struct with no value says it', () => {
    const { field, problems } = one({ kind: 'select', default: null, constraints: null, options: null, validate: null, visibleWhen: null, enabledWhen: null, notes: null, hint: null, restart: null, keywords: null });
    expect(problems).toEqual([]);
    expect(field.validate).toBeUndefined();
    expect(field.visible).toBeUndefined();
    expect(field.enabled).toBeUndefined();
    expect(field.notes).toEqual([]);
    expect(field.default).toBeUndefined();
  });
});

describe('conditions', () => {
  it('are compiled where they are written, and say what they read', () => {
    const { field } = one(
      { id: 'min', kind: 'number', visibleWhen: { field: 'mode', equals: 'advanced' }, enabledWhen: { all: [{ field: 'on', equals: true, reason: 'Turn on Folding to change this.' }, { ctx: 'developer', equals: true }] }, notes: [{ when: { field: 'min', gt: 10 }, kind: 'warning', text: 'That is a lot.' }] },
      [{ id: 'mode', kind: 'text' }, { id: 'on', kind: 'boolean' }],
    );
    expect(field.visible?.fields).toEqual(['mode']);
    expect(field.enabled?.fields).toEqual(['on']);
    expect(field.enabled?.ctx).toEqual(['developer']);
    expect(field.notes.map((note) => [note.kind, note.text, note.when.fields])).toEqual([['warning', 'That is a lot.', ['min']]]);
  });

  it('read a field that is declared later in the schema: ids are known before any condition is read', () => {
    const { field, problems } = one({ id: 'a', kind: 'text', visibleWhen: { field: 'z', equals: 1 } }, [{ id: 'z', kind: 'number' }]);
    expect(problems).toEqual([]);
    expect(field.visible?.fields).toEqual(['z']);
  });

  it('say where a problem is: the path of the condition', () => {
    const result = compileSchema({ sections: [{ fields: [{ id: 'a', kind: 'text' }, { id: 'b', kind: 'text', visibleWhen: { field: 'nope', equals: 1 } }] }] });
    expect(result.ok && result.problems.map((problem) => [problem.code, problem.path])).toEqual([['unknown-field', 'sections[0].fields[1].visibleWhen']]);
  });

  it('keep at most four notes, each with plain text and a kind', () => {
    const notes = Array.from({ length: 8 }, (_, index) => ({ when: true, text: `Note ${String(index)}.` }));
    const { field } = one({ notes });
    expect(field.notes).toHaveLength(LIMITS.notes);
    expect(field.notes[0]?.kind).toBe('info');
    expect(one({ notes: [{ when: true }, { text: 'No condition.' }, { when: true, text: 4 }, null] }).field.notes).toEqual([expect.objectContaining({ text: 'No condition.' })]);
  });

  it('are listed backwards: for each field, the conditions that read it, so a change re-runs only those', () => {
    const { schema } = one(
      { id: 'a', kind: 'text', visibleWhen: { field: 'x', equals: 1 }, enabledWhen: { field: 'y', equals: 1 } },
      [{ id: 'b', kind: 'text', enabledWhen: { field: 'x', equals: 2 }, notes: [{ when: { field: 'x', equals: 3 }, text: 'N.' }] }, { id: 'x', kind: 'number' }, { id: 'y', kind: 'number' }],
    );
    expect(schema.readers.get('x')).toEqual([{ target: 'a', slot: 'visible' }, { target: 'b', slot: 'enabled' }, { target: 'b', slot: 'notes' }]);
    expect(schema.readers.get('y')).toEqual([{ target: 'a', slot: 'enabled' }]);
    expect(schema.readers.get('a')).toBeUndefined();
  });

  it('list the flags the host sets the same way, for fields and for sections', () => {
    const { schema } = compiled({ sections: [{ id: 's', visibleWhen: { ctx: 'developer', equals: true }, fields: [{ id: 'a', kind: 'text', visibleWhen: { ctx: 'developer', equals: true } }] }] });
    expect(schema.ctxReaders.get('developer')).toEqual([{ target: 's', slot: 'section' }, { target: 'a', slot: 'visible' }]);
  });

  it('list what a field\'s own check depends on: sameAs and dependsOn', () => {
    const { schema } = one({ id: 'again', kind: 'text', constraints: { sameAs: 'pw' } }, [{ id: 'pw', kind: 'text' }, { id: 'probe', kind: 'path', validate: { remote: 'p', dependsOn: ['pw', 'again'] } }]);
    expect(schema.dependents.get('pw')).toEqual(['again', 'probe']);
    expect(schema.dependents.get('again')).toEqual(['probe']);
  });
});

describe('the rest of a field', () => {
  it('has a restart (true is the app\'s), a read-only flag, a display hint and a mono flag', () => {
    expect(one({ restart: true }).field.restart).toBe('app');
    expect(one({ restart: 'app' }).field.restart).toBe('app');
    expect(one({ restart: 'plugin' }).field.restart).toBe('plugin');
    expect(one({ restart: 'later' }).field.restart).toBe('none');
    expect(one({}).field.restart).toBe('none');
    expect(one({ readonly: true }).field.readonly).toBe(true);
    expect(one({ display: 'slider', mono: true }).field).toMatchObject({ display: 'slider', mono: true });
    expect(one({ display: '\u001b[1mx'.repeat(40) }).field.display.length).toBeLessThanOrEqual(24);
  });
});

describe('versions', () => {
  it('reads a schema with no version as version 1, and refuses a newer one: it is never half used', () => {
    expect(compileSchema({ sections: [] }).ok).toBe(true);
    expect(compileSchema({ version: 1, sections: [] }).ok).toBe(true);
    const newer = compileSchema({ version: SCHEMA_VERSION + 1, sections: [] });
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.reason).toBe('foreign-version');
    expect(!newer.ok && newer.detail).toContain(String(SCHEMA_VERSION + 1));
  });

  it('refuses a version that is not a whole number of zero or more', () => {
    for (const version of [-1, 1.5, '1', Number.NaN, {}]) {
      const result = compileSchema({ version, sections: [] });
      expect(result.ok, `version ${JSON.stringify(version) ?? 'undefined'}`).toBe(false);
      expect(!result.ok && result.reason).toBe('unreadable');
    }
  });

  it('brings an older schema up through the steps the host gives, each step reading plain data and answering plain data', () => {
    const legacy = { version: 0, id: 'old', settings: [{ key: 'a', type: 'text' }] };
    const up = (raw: Record<string, unknown>): unknown => ({ ...raw, sections: [{ fields: (raw.settings as ReadonlyArray<{ key: string; type: string }>).map((entry) => ({ id: entry.key, kind: entry.type })) }] });
    const { schema } = compiled(legacy, { migrations: { 0: up } });
    expect(schema.id).toBe('old');
    expect(schema.version).toBe(SCHEMA_VERSION);
    expect(schema.fields.map((field) => field.id)).toEqual(['a']);
  });

  it('says foreign-version for an older schema that has no way up, and unreadable when a step throws or answers what is not data', () => {
    const none = compileSchema({ version: 0, sections: [] });
    expect(!none.ok && none.reason).toBe('foreign-version');
    const throws = compileSchema({ version: 0, sections: [] }, { migrations: { 0: () => {
      throw new Error('boom'); 
    } } });
    expect(!throws.ok && throws.reason).toBe('unreadable');
    for (const answer of [null, 4, 'x', [], undefined]) {
      const bad = compileSchema({ version: 0, sections: [] }, { migrations: { 0: () => answer } });
      expect(!bad.ok && bad.reason, String(answer)).toBe('unreadable');
    }
  });

  it('has no step of its own at version 1: the first release has nothing to migrate from', () => {
    expect(MIGRATIONS).toEqual({});
    expect(Object.isFrozen(MIGRATIONS)).toBe(true);
  });
});

describe('what is not a schema', () => {
  it('is unreadable, and says so, whatever it is', () => {
    for (const raw of [null, undefined, 4, 'sections', [], true, () => ({ sections: [] }), { sections: 'no' }, { sections: {} }, {}]) {
      const result = compileSchema(raw);
      expect(result.ok, `raw ${typeof raw}`).toBe(false);
      expect(!result.ok && result.reason).toBe('unreadable');
    }
  });

  it('never throws, even for an object that throws when it is read', () => {
    const hostile = new Proxy({}, { get: () => {
      throw new Error('no'); 
    }, has: () => {
      throw new Error('no'); 
    }, ownKeys: () => {
      throw new Error('no'); 
    }, getOwnPropertyDescriptor: () => {
      throw new Error('no'); 
    } });
    expect(compileSchema(hostile).ok).toBe(false);
    const inner = { sections: [{ fields: [new Proxy({}, { get: () => {
      throw new Error('no'); 
    }, ownKeys: () => {
      throw new Error('no'); 
    } })] }] };
    expect(() => compileSchema(inner)).not.toThrow();
  });

  it('bounds a schema that is huge: a very long text, a very long list of options, a very deep default', () => {
    let deep: unknown = 'x';
    for (let level = 0; level < 200; level += 1) {
      deep = [deep];
    }

    const { problems } = compiled({ sections: [{ fields: [{ id: 'a', kind: 'list', default: deep, label: 'L'.repeat(1_000_000) }] }] });
    expect(problems).toContain('bad-default');
  });
});
