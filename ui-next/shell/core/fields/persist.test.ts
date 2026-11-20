import { describe, expect, it } from 'vitest';
import { DRAFT_MIGRATIONS, restoreDraft } from './persist';
import { compileSchema, type CompiledSchema } from './schema';
import { makeForm, schemaOf, valuesOf } from './testing';
import { FORM_VERSION } from './types';

// A draft is what a page keeps across a switch of tabs or a restart (the tab model's `pageState`, the session): the values the user changed, as a versioned document that a restore
// REPAIRS rather than discards (the tab model's and the palette's rule). It never holds a secret, and a draft for another form is never applied.

const SCHEMA = schemaOf(
  { id: 'name', kind: 'text', default: 'x' },
  { id: 'port', kind: 'number', default: 80 },
  { id: 'tags', kind: 'list', default: [] },
  { id: 'token', kind: 'secret' },
  { id: 'future', kind: 'duration' },
  { id: 'on', kind: 'boolean', default: false },
);

function compiled(): CompiledSchema {
  const result = compileSchema(SCHEMA);
  if (!result.ok) {
    throw new Error(result.detail);
  }

  return result.schema;
}

describe('what is saved of a draft', () => {
  it('is the version, which form it is for, and the values that differ from the applied ones: nothing when nothing changed', () => {
    const { store } = makeForm(SCHEMA);
    expect(store.serialise()).toEqual({ version: FORM_VERSION, schema: 'form', values: {} });
    store.setValue('name', 'api');
    store.setValue('tags', ['a']);
    store.setValue('on', true);
    expect(store.serialise()).toEqual({ version: 1, schema: 'form', values: { name: 'api', tags: ['a'], on: true } });
  });

  it('keeps what a user typed in a number field that is not a number yet', () => {
    const { store } = makeForm(SCHEMA);
    store.setValue('port', '80a');
    expect(store.serialise().values).toEqual({ port: '80a' });
  });

  it('is plain JSON that comes back the same', () => {
    const { store } = makeForm(SCHEMA);
    store.setValue('name', 'api');
    const saved = store.serialise();
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it('leaves out a value that went back to the applied one', () => {
    const { store } = makeForm(SCHEMA);
    store.setValue('name', 'api');
    store.setValue('name', 'x');
    expect(store.serialise().values).toEqual({});
  });
});

describe('reading it back', () => {
  it('gives the values to start a form with, and a form that starts with them is dirty by exactly those', () => {
    const saved = { version: 1, schema: 'form', values: { name: 'api', tags: ['a'] } };
    const result = restoreDraft(saved, compiled());
    expect(result).toMatchObject({ ok: true, repaired: false, problems: [], values: { name: 'api', tags: ['a'] } });
    const { store } = makeForm(SCHEMA, { draft: result.ok ? result.values : {} });
    expect(valuesOf(store.getSnapshot())).toMatchObject({ name: 'api', tags: ['a'], port: 80 });
    expect(store.getSnapshot().dirtyIds).toEqual(['name', 'tags']);
  });

  it('round-trips what a store saved', () => {
    const first = makeForm(SCHEMA);
    first.store.setValue('name', 'api');
    first.store.setValue('on', true);
    const restored = restoreDraft(JSON.parse(JSON.stringify(first.store.serialise())), compiled());
    const second = makeForm(SCHEMA, { draft: restored.ok ? restored.values : {} });
    expect(second.store.serialise()).toEqual(first.store.serialise());
  });

  it('repairs rather than discards: a value that is not for a field, a secret, a kind it does not know, and a value of the wrong type are dropped alone, and said', () => {
    const saved = { version: 1, schema: 'form', values: { name: 'api', nothing: 'x', token: 'sk-live', future: '5s', port: { x: 1 }, tags: [1], on: 'yes' } };
    const result = restoreDraft(saved, compiled());
    expect(result).toMatchObject({ ok: true, repaired: true, values: { name: 'api' } });
    expect(result.ok && Object.keys(result.values)).toEqual(['name']);
    expect(result.ok && result.problems).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain('sk-live');
  });

  it('says why it cannot when there is nothing, or it is not a draft, or it is for another form, or another version', () => {
    expect(restoreDraft(undefined, compiled())).toMatchObject({ ok: false, reason: 'missing' });
    expect(restoreDraft(null, compiled())).toMatchObject({ ok: false, reason: 'missing' });
    for (const raw of ['text', 4, [], {}, { version: 1 }, { version: 1, schema: 'form' }, { version: 1, schema: 'form', values: [] }, { version: 'x', schema: 'form', values: {} }]) {
      expect(restoreDraft(raw, compiled()), JSON.stringify(raw)).toMatchObject({ ok: false, reason: 'unreadable' });
    }

    expect(restoreDraft({ version: 1, schema: 'another', values: {} }, compiled())).toMatchObject({ ok: false, reason: 'other-form' });
    expect(restoreDraft({ version: 2, schema: 'form', values: {} }, compiled())).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(restoreDraft({ version: 0, schema: 'form', values: {} }, compiled())).toMatchObject({ ok: false, reason: 'foreign-version' });
  });

  it('brings an older draft up through the steps it is given', () => {
    const old = { version: 0, schema: 'form', values: { title: 'api' } };
    const result = restoreDraft(old, compiled(), { migrations: { 0: (raw) => ({ ...raw, values: { name: (raw.values as { title: string }).title } }) } });
    expect(result).toMatchObject({ ok: true, values: { name: 'api' } });
    expect(DRAFT_MIGRATIONS).toEqual({});
    expect(Object.isFrozen(DRAFT_MIGRATIONS)).toBe(true);
  });

  it('is not troubled by a step that throws or answers what is not data', () => {
    expect(restoreDraft({ version: 0, schema: 'form', values: {} }, compiled(), { migrations: { 0: () => {
      throw new Error('boom'); 
    } } })).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restoreDraft({ version: 0, schema: 'form', values: {} }, compiled(), { migrations: { 0: () => 4 } })).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('is not troubled by a draft that is hostile: a prototype key, a huge list, a deep value', () => {
    let deep: unknown = 'x';
    for (let level = 0; level < 100; level += 1) {
      deep = [deep];
    }

    const text = '{"version":1,"schema":"form","values":{"__proto__":{"polluted":true},"name":"ok"}}';
    const result = restoreDraft(JSON.parse(text), compiled());
    expect(result.ok && Object.keys(result.values)).toEqual(['name']);
    const plain: Record<string, unknown> = {};
    expect(plain.polluted).toBeUndefined();
    expect(restoreDraft({ version: 1, schema: 'form', values: { tags: deep, name: 'a'.repeat(1_000_000) } }, compiled())).toMatchObject({ ok: true, repaired: true });
  });
});
