import { describe, expect, it } from 'vitest';
import { makeForm, schemaOf, valuesOf } from './testing';
import type { FieldState } from './types';

// The store: one immutable snapshot (a frozen, JSON-shaped `FormState` with a `version`), `subscribe`, and the operations. This file is the core: values, dirty, touched, conditions,
// locks, what the submit button knows, the snapshot's identity rules. The checks' timing is `validation.test.ts`, the two modes `modes.test.ts`, asynchronous work `async.test.ts`.

const BASIC = schemaOf(
  { id: 'name', kind: 'text', label: 'Name', default: 'x' },
  { id: 'port', kind: 'number', label: 'Port', default: 8080, unit: 'port', constraints: { min: 1, max: 65_535, integer: true } },
  { id: 'on', kind: 'boolean', label: 'Enabled' },
  { id: 'mode', kind: 'select', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  { id: 'tags', kind: 'list', label: 'Tags', default: ['one'] },
);

const field = (state: { readonly fields: readonly FieldState[] }, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

describe('the first snapshot', () => {
  it('has every field in order with its default, nothing dirty, nothing touched, and says what it is', () => {
    const { store } = makeForm(BASIC);
    const state = store.getSnapshot();
    expect(state.version).toBe(1);
    expect(state.mode).toBe('explicit');
    expect(state.schema).toEqual({ id: 'form', version: 1 });
    expect(state.fields.map((entry) => entry.id)).toEqual(['name', 'port', 'on', 'mode', 'tags']);
    expect(valuesOf(state)).toEqual({ name: 'x', port: 8080, on: false, mode: 'a', tags: ['one'] });
    expect(state.dirty).toBe(false);
    expect(state.dirtyIds).toEqual([]);
    expect(state.fields.every((entry) => !entry.dirty && !entry.touched && !entry.edited)).toBe(true);
    expect(state.submit).toEqual({ status: 'idle', attempted: false, attempts: 0 });
    expect(state.issues).toEqual([]);
    expect(state.lock).toBeUndefined();
  });

  it('takes the applied values the host has, over the defaults, ignores a value that is not for a field or is of the wrong type, and keeps one that is not offered (the host is the truth)', () => {
    const { store } = makeForm(BASIC, { initial: { name: 'api', port: 9000, nothing: 'x', on: 'yes', mode: 'c', tags: [1, 2] } });
    expect(valuesOf(store.getSnapshot())).toEqual({ name: 'api', port: 9000, on: false, mode: 'c', tags: ['one'] });
    expect(store.getSnapshot().dirty).toBe(false);
  });

  it('is frozen and JSON-shaped: it can be kept, compared and copied as it is', () => {
    const { store } = makeForm(BASIC);
    const state = store.getSnapshot();
    for (const value of [state, state.fields, state.sections, state.fields[0], state.fields[0]?.spec, state.dirtyIds, state.submit]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is the same object until something changes', () => {
    const { store } = makeForm(BASIC);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('describes each field for a view: label, help, kind, what its constraints say a control needs', () => {
    const { store } = makeForm(schemaOf({ id: 'p', kind: 'number', label: 'Port', help: 'Where it listens.', unit: 's', hint: '1 to 300', constraints: { min: 1, max: 300, step: 5, integer: true, required: true }, display: 'slider', mono: true }));
    expect(field(store.getSnapshot(), 'p')).toMatchObject({
      kind: 'number',
      label: 'Port',
      help: 'Where it listens.',
      required: true,
      sensitive: false,
      visible: true,
      enabled: true,
      readonly: false,
      spec: { unit: 's', min: 1, max: 300, step: 5, integer: true, display: 'slider', mono: true, remote: false },
    });
  });

  it('has the sections, with their fields and their counts', () => {
    const { store } = makeForm({ sections: [{ id: 'a', label: 'A', help: 'First.', fields: [{ id: 'x', kind: 'text' }] }, { id: 'b', collapsed: true, fields: [{ id: 'y', kind: 'text' }] }] });
    expect(store.getSnapshot().sections).toEqual([
      { id: 'a', label: 'A', help: 'First.', collapsed: false, visible: true, fields: ['x'], invalid: 0, dirty: 0 },
      { id: 'b', label: '', help: '', collapsed: true, visible: true, fields: ['y'], invalid: 0, dirty: 0 },
    ]);
  });
});

describe('setValue', () => {
  it('changes one value, marks it dirty and edited, and tells the listeners once', () => {
    const { store, seen } = makeForm(BASIC);
    const before = store.getSnapshot();
    expect(store.setValue('name', 'api')).toEqual({ status: 'set' });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(field(after, 'name')).toMatchObject({ value: 'api', dirty: true, edited: true, touched: false, modified: true });
    expect(after.dirty).toBe(true);
    expect(after.dirtyIds).toEqual(['name']);
    expect(seen).toEqual([after]);
  });

  it('does nothing, and tells nobody, when the value is the one it has', () => {
    const { store, seen } = makeForm(BASIC);
    const before = store.getSnapshot();
    expect(store.setValue('name', 'x')).toEqual({ status: 'noop' });
    expect(store.getSnapshot()).toBe(before);
    expect(seen).toEqual([]);
  });

  it('is clean again when the value goes back to the applied one, and compares a list by what is in it', () => {
    const { store } = makeForm(BASIC);
    store.setValue('name', 'y');
    store.setValue('tags', ['one', 'two']);
    expect(store.getSnapshot().dirtyIds).toEqual(['name', 'tags']);
    store.setValue('name', 'x');
    store.setValue('tags', ['one']);
    expect(store.getSnapshot().dirtyIds).toEqual([]);
    expect(store.getSnapshot().dirty).toBe(false);
    expect(field(store.getSnapshot(), 'name').edited).toBe(true);
  });

  it('keeps what a user typed in a number field that is not a number yet, and reads it when it is', () => {
    const { store } = makeForm(BASIC);
    store.setValue('port', '80a');
    expect(field(store.getSnapshot(), 'port').value).toBe('80a');
    store.setValue('port', '81');
    expect(field(store.getSnapshot(), 'port').value).toBe(81);
    store.setValue('port', '');
    expect(field(store.getSnapshot(), 'port').value).toBeUndefined();
    store.setValue('port', 82);
    expect(field(store.getSnapshot(), 'port').value).toBe(82);
  });

  it('refuses what it cannot take, and changes nothing: an unknown field, a kind this build does not know, the wrong type', () => {
    const { store, seen } = makeForm(schemaOf({ id: 'a', kind: 'text' }, { id: 'future', kind: 'duration' }, { id: 'n', kind: 'number' }, { id: 'l', kind: 'list' }));
    const before = store.getSnapshot();
    expect(store.setValue('missing', 'x')).toEqual({ status: 'refused', reason: 'unknown-field' });
    expect(store.setValue('future', '5s')).toEqual({ status: 'refused', reason: 'unsupported' });
    expect(store.setValue('a', 5)).toEqual({ status: 'refused', reason: 'type' });
    expect(store.setValue('n', { x: 1 })).toEqual({ status: 'refused', reason: 'type' });
    expect(store.setValue('l', [1])).toEqual({ status: 'refused', reason: 'type' });
    expect(store.setValue('__proto__', 'x')).toEqual({ status: 'refused', reason: 'unknown-field' });
    expect(store.getSnapshot()).toBe(before);
    expect(seen).toEqual([]);
  });

  it('refuses a field that is hidden, locked or read-only', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', visibleWhen: false }, { id: 'b', kind: 'text', readonly: true }, { id: 'c', kind: 'text', enabledWhen: false }));
    expect(store.setValue('a', 'x')).toEqual({ status: 'refused', reason: 'hidden' });
    expect(store.setValue('b', 'x')).toEqual({ status: 'refused', reason: 'locked' });
    expect(store.setValue('c', 'x')).toEqual({ status: 'refused', reason: 'locked' });
  });

  it('is told apart from the draft of a field that has a default: the reset marker shows only when the value differs from the default', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', default: 'd' }));
    expect(field(store.getSnapshot(), 'a').modified).toBe(false);
    store.setValue('a', 'e');
    expect(field(store.getSnapshot(), 'a').modified).toBe(true);
    store.setValue('a', 'd');
    expect(field(store.getSnapshot(), 'a').modified).toBe(false);
  });

  it('shows the marker for a value that was applied and differs from the default, though nothing is dirty', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', default: 'd' }), { initial: { a: 'applied' } });
    expect(field(store.getSnapshot(), 'a')).toMatchObject({ modified: true, dirty: false });
  });
});

describe('touched, edited and revert', () => {
  it('a field is touched when the user leaves it, whether or not it changed; edited when it changed', async () => {
    const { store } = makeForm(BASIC);
    await store.blur('name');
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ touched: true, edited: false, dirty: false });
    store.setValue('mode', 'b');
    expect(field(store.getSnapshot(), 'mode')).toMatchObject({ touched: false, edited: true });
  });

  it('revert puts one field back to its applied value, as if the user had not touched it', async () => {
    const { store } = makeForm(BASIC);
    store.setValue('name', 'y');
    await store.blur('name');
    expect(store.revert('name')).toBe(true);
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ value: 'x', dirty: false, touched: false, edited: false });
    expect(store.revert('name')).toBe(false);
  });

  it('revert with no field puts every field back, and the submit state with them', async () => {
    const { store } = makeForm(BASIC);
    store.setValue('name', 'y');
    store.setValue('port', 1);
    expect(store.revert()).toBe(true);
    expect(valuesOf(store.getSnapshot())).toEqual({ name: 'x', port: 8080, on: false, mode: 'a', tags: ['one'] });
    expect(store.getSnapshot().dirty).toBe(false);
    expect(store.revert()).toBe(false);
  });

  it('revert of an unknown field does nothing', () => {
    const { store } = makeForm(BASIC);
    expect(store.revert('missing')).toBe(false);
  });
});

describe('conditions', () => {
  const schema = {
    sections: [
      { id: 'basic', fields: [{ id: 'mode', kind: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }, { id: 'extra', kind: 'text', visibleWhen: { field: 'mode', equals: 'b' } }] },
      { id: 'dev', visibleWhen: { ctx: 'developer', equals: true }, fields: [{ id: 'port', kind: 'number' }] },
    ],
  };

  it('show a field when its condition holds, and hide it when it stops', () => {
    const { store } = makeForm(schema);
    expect(field(store.getSnapshot(), 'extra').visible).toBe(false);
    store.setValue('mode', 'b');
    expect(field(store.getSnapshot(), 'extra').visible).toBe(true);
    store.setValue('mode', 'a');
    expect(field(store.getSnapshot(), 'extra').visible).toBe(false);
  });

  it('read the flags the host sets, for a field and for a whole section', () => {
    const { store, seen } = makeForm(schema);
    expect(store.getSnapshot().sections.map((section) => [section.id, section.visible])).toEqual([['basic', true], ['dev', false]]);
    expect(field(store.getSnapshot(), 'port').visible).toBe(false);
    expect(store.setContext({ developer: true })).toBe(true);
    expect(store.getSnapshot().sections.map((section) => section.visible)).toEqual([true, true]);
    expect(field(store.getSnapshot(), 'port').visible).toBe(true);
    expect(store.setContext({ developer: true })).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('keep what a hidden field holds, so it is there when the field comes back', () => {
    const { store } = makeForm(schema);
    store.setValue('mode', 'b');
    store.setValue('extra', 'typed');
    store.setValue('mode', 'a');
    store.setValue('mode', 'b');
    expect(field(store.getSnapshot(), 'extra').value).toBe('typed');
  });

  it('lock a field that is not available, and say why in the words of the schema (DR1)', () => {
    const { store } = makeForm(schemaOf(
      { id: 'folding', kind: 'boolean', default: true },
      { id: 'highlight', kind: 'boolean', enabledWhen: { field: 'folding', equals: true, reason: 'Turn on Folding to change this.' } },
    ));
    expect(field(store.getSnapshot(), 'highlight')).toMatchObject({ enabled: true });
    expect(field(store.getSnapshot(), 'highlight').lock).toBeUndefined();
    store.setValue('folding', false);
    const locked = field(store.getSnapshot(), 'highlight');
    expect(locked).toMatchObject({ enabled: false, readonly: false, lock: { reason: 'Turn on Folding to change this.', source: 'condition', readonly: false } });
    expect(locked.message).toEqual({ kind: 'info', text: 'Turn on Folding to change this.' });
    expect(store.setValue('highlight', true)).toEqual({ status: 'refused', reason: 'locked' });
    store.setValue('folding', true);
    expect(field(store.getSnapshot(), 'highlight')).toMatchObject({ enabled: true });
    expect(field(store.getSnapshot(), 'highlight').lock).toBeUndefined();
  });

  it('say the first requirement that is not met, in the order they were written (S126)', () => {
    const { store } = makeForm(schemaOf(
      { id: 'telemetry', kind: 'boolean', default: false },
      { id: 'ship', kind: 'boolean', default: false },
      { id: 'level', kind: 'text', enabledWhen: { all: [{ field: 'telemetry', equals: true, reason: 'Turn on Send telemetry to change this.' }, { field: 'ship', equals: true, reason: 'Turn on Ship logs to change this.' }] } },
    ));
    expect(field(store.getSnapshot(), 'level').lock?.reason).toBe('Turn on Send telemetry to change this.');
    store.setValue('telemetry', true);
    expect(field(store.getSnapshot(), 'level').lock?.reason).toBe('Turn on Ship logs to change this.');
    store.setValue('ship', true);
    expect(field(store.getSnapshot(), 'level').lock).toBeUndefined();
  });

  it('are re-run only for what changed: a change reads the conditions that read it, and no others', () => {
    const { store } = makeForm(schemaOf(
      { id: 'a', kind: 'text' },
      { id: 'b', kind: 'text' },
      { id: 'x', kind: 'text', visibleWhen: { field: 'a', empty: false } },
      { id: 'y', kind: 'text', enabledWhen: { field: 'a', empty: false } },
      { id: 'z', kind: 'text', visibleWhen: { field: 'b', empty: false } },
    ));
    const before = store.stats();
    store.setValue('a', 'v');
    expect(store.stats().conditions - before.conditions).toBe(2);
    store.setValue('b', 'w');
    expect(store.stats().conditions - before.conditions).toBe(3);
  });
});

describe('locks the host sets', () => {
  it('a value set by an environment variable is read-only, not disabled (F-4), and says so; it can be freed', () => {
    const { store } = makeForm(BASIC);
    expect(store.setFieldLock('name', { reason: 'Set by environment variable', source: 'environment', readonly: true })).toBe(true);
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ readonly: true, enabled: true, lock: { source: 'environment', readonly: true } });
    expect(field(store.getSnapshot(), 'name').message).toEqual({ kind: 'info', text: 'Set by environment variable' });
    expect(store.setValue('name', 'y')).toEqual({ status: 'refused', reason: 'locked' });
    expect(store.setFieldLock('name', undefined)).toBe(true);
    expect(store.setValue('name', 'y')).toEqual({ status: 'set' });
    expect(store.setFieldLock('missing', undefined)).toBe(false);
  });

  it('a plugin that is not running, or a store that cannot be written, disables the whole form, and says why', () => {
    const { store } = makeForm(BASIC);
    expect(store.setFormLock({ reason: 'Start the plugin to change this.', source: 'plugin', readonly: false })).toBe(true);
    const state = store.getSnapshot();
    expect(state.lock).toEqual({ reason: 'Start the plugin to change this.', source: 'plugin', readonly: false });
    expect(state.fields.every((entry) => !entry.enabled && entry.lock?.source === 'plugin')).toBe(true);
    expect(state.canSubmit).toBe(false);
    expect(state.submitBlocked).toBe('Start the plugin to change this.');
    expect(store.setValue('name', 'y')).toEqual({ status: 'refused', reason: 'locked' });
    store.setFormLock(undefined);
    expect(store.getSnapshot().fields.every((entry) => entry.enabled)).toBe(true);
  });

  it('the form\'s lock outranks the field\'s, which outranks a condition (the lab: the store, the plugin, an environment variable, a managed value, a dependency)', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', enabledWhen: { field: 'a', equals: 'never', reason: 'Dependency.' } }));
    expect(field(store.getSnapshot(), 'a').lock?.reason).toBe('Dependency.');
    store.setFieldLock('a', { reason: 'Managed.', source: 'managed', readonly: true });
    expect(field(store.getSnapshot(), 'a').lock?.reason).toBe('Managed.');
    store.setFormLock({ reason: 'Store.', source: 'store', readonly: false });
    expect(field(store.getSnapshot(), 'a').lock?.reason).toBe('Store.');
  });

  it('a locked field can still be put back to its applied value: revert only discards', () => {
    const { store } = makeForm(BASIC);
    store.setValue('name', 'y');
    store.setFormLock({ reason: 'Locked.', source: 'store', readonly: false });
    expect(store.revert('name')).toBe(true);
    expect(field(store.getSnapshot(), 'name').value).toBe('x');
  });

  it('a kind this build does not know is shown read-only and says it is not supported in this version', () => {
    const { store } = makeForm(schemaOf({ id: 'future', kind: 'duration', label: 'Timeout', help: 'How long.' }));
    expect(field(store.getSnapshot(), 'future')).toMatchObject({
      kind: 'unsupported',
      label: 'Timeout',
      readonly: true,
      enabled: true,
      unsupported: { kind: 'duration', text: 'Not supported in this version.' },
      message: { kind: 'info', text: 'Not supported in this version.' },
    });
    expect(field(store.getSnapshot(), 'future').value).toBeUndefined();
    expect(store.getSnapshot().dirty).toBe(false);
  });
});

describe('what the submit button knows', () => {
  it('a form of up to three inputs and nothing else is simple: confirmation waits for the required values, and says what is missing', () => {
    const { store } = makeForm(schemaOf({ id: 'name', kind: 'text', label: 'Name', constraints: { required: true } }, { id: 'url', kind: 'url', label: 'URL' }), { send: 'all' });
    const state = store.getSnapshot();
    expect(state.class).toBe('simple');
    expect(state.canSubmit).toBe(false);
    expect(state.submitBlocked).toBe('Name is required.');
    store.setValue('name', 'api');
    expect(store.getSnapshot().canSubmit).toBe(true);
    expect(store.getSnapshot().submitBlocked).toBe('');
  });

  it('a form with more than three inputs, or any other kind of control, is complex: confirmation stays enabled so a submit can explain what is missing', () => {
    const four = makeForm(schemaOf(...['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'text', constraints: { required: true } }))), { send: 'all' });
    expect(four.store.getSnapshot()).toMatchObject({ class: 'complex', canSubmit: true, submitBlocked: '' });
    const withSwitch = makeForm(schemaOf({ id: 'a', kind: 'text', constraints: { required: true } }, { id: 'on', kind: 'boolean' }), { send: 'all' });
    expect(withSwitch.store.getSnapshot()).toMatchObject({ class: 'complex', canSubmit: true });
  });

  it('counts the fields that are shown: a hidden field is not an input of the form', () => {
    const { store } = makeForm(schemaOf(...['a', 'b', 'c'].map((id) => ({ id, kind: 'text' })), { id: 'd', kind: 'text', visibleWhen: false }));
    expect(store.getSnapshot().class).toBe('simple');
  });

  it('Apply is disabled when nothing changed, and says so, unless the form sends everything', () => {
    const changed = makeForm(BASIC);
    expect(changed.store.getSnapshot()).toMatchObject({ canSubmit: false, submitBlocked: 'No changes to apply.' });
    changed.store.setValue('name', 'y');
    expect(changed.store.getSnapshot()).toMatchObject({ canSubmit: true, submitBlocked: '' });
    expect(makeForm(BASIC, { send: 'all' }).store.getSnapshot().canSubmit).toBe(true);
  });

  it('there is no submit in a form that applies on change', () => {
    const { store } = makeForm(BASIC, { mode: 'apply-on-change' });
    expect(store.getSnapshot()).toMatchObject({ mode: 'apply-on-change', canSubmit: false, submitBlocked: '' });
  });
});

describe('subscribe', () => {
  it('tells each listener once per change, in the order they came, and stops when asked', () => {
    const { store } = makeForm(BASIC);
    const calls: string[] = [];
    const first = store.subscribe(() => calls.push('first'));
    store.subscribe(() => calls.push('second'));
    store.setValue('name', 'y');
    expect(calls).toEqual(['first', 'second']);
    first();
    store.setValue('name', 'z');
    expect(calls).toEqual(['first', 'second', 'second']);
  });

  it('is not stopped by a listener that throws: the others are told, and the failure is reported without the error object', () => {
    const { store, errors } = makeForm(BASIC);
    const calls: string[] = [];
    store.subscribe(() => {
      throw new Error('listener failed'); 
    });
    store.subscribe(() => calls.push('second'));
    store.setValue('name', 'y');
    expect(calls).toEqual(['second']);
    expect(errors).toEqual([{ name: 'Error', message: 'listener failed', where: 'listener' }]);
  });

  it('subscribeTo tells a listener only when what it selects changed, with the new value and the old', () => {
    const { store } = makeForm(BASIC);
    const seen: Array<readonly [unknown, unknown]> = [];
    store.subscribeTo((state) => field(state, 'name').value, (value, previous) => seen.push([value, previous]));
    store.setValue('port', 1);
    store.setValue('name', 'y');
    store.setValue('name', 'z');
    expect(seen).toEqual([['y', 'x'], ['z', 'y']]);
  });

  it('subscribeTo takes the comparison it is given', () => {
    const { store } = makeForm(BASIC);
    const seen: number[] = [];
    store.subscribeTo((state) => state.dirtyIds, (ids) => seen.push(ids.length), (a, b) => a.length === b.length);
    store.setValue('name', 'y');
    store.setValue('name', 'z');
    store.setValue('port', 2);
    expect(seen).toEqual([1, 2]);
  });
});

describe('the identity of what did not change', () => {
  it('a field that is not the one that changed is the same object, so a row that draws it does not draw again', () => {
    const { store } = makeForm(BASIC);
    const before = store.getSnapshot();
    store.setValue('name', 'y');
    const after = store.getSnapshot();
    expect(field(after, 'name')).not.toBe(field(before, 'name'));
    for (const id of ['port', 'on', 'mode', 'tags']) {
      expect(field(after, id)).toBe(field(before, id));
    }

    // A section counts what is dirty in it, for the navigation to mark: it changes when that count does, and not for another change in the same field.
    expect(after.sections[0]).toMatchObject({ dirty: 1 });
    store.setValue('name', 'z');
    expect(store.getSnapshot().sections).toBe(after.sections);
  });

  it('field(id) is the field of the current snapshot, and an unknown id is nothing', () => {
    const { store } = makeForm(BASIC);
    expect(store.field('name')).toBe(field(store.getSnapshot(), 'name'));
    expect(store.field('missing')).toBeUndefined();
  });
});

describe('dispose', () => {
  it('stops the store: no more changes, no more notifications, no timer left, and the last snapshot stays readable', () => {
    const { store, clock, seen } = makeForm(BASIC);
    store.setValue('name', 'y');
    const last = store.getSnapshot();
    store.dispose();
    expect(store.setValue('name', 'z')).toEqual({ status: 'refused', reason: 'disposed' });
    expect(store.revert()).toBe(false);
    expect(store.setContext({ developer: true })).toBe(false);
    expect(store.getSnapshot()).toBe(last);
    expect(seen).toHaveLength(1);
    expect(clock.pending()).toBe(0);
    store.dispose();
  });
});
