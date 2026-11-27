import { describe, expect, it } from 'vitest';
import { compileSchema } from '../../core/fields';
import { modelOf, NOT_DRAWN } from './adapter';
import { category, hostSnapshot, setting } from './testing';
import type { HostSnapshot } from './types';

// The adapter reads what the host's settings service declares and writes the form model's schema, so that the Settings sheet draws each field by its kind and nothing is a hand-written form. These tests
// read the host's own categories as the Go side declares them today (`testing.ts`) and the cases that a plugin's or a newer host's snapshot would add.

const REAL = hostSnapshot({}, { 'telemetry.auth_value': true });
const model = modelOf(REAL);
const kindOf = (id: string): string | undefined => model.schema.sections.flatMap((section) => section.fields).find((field) => field.id === id)?.kind;
const fieldOf = (id: string) => model.schema.sections.flatMap((section) => section.fields).find((field) => field.id === id);

describe('the pages', () => {
  it('are the host categories in the deliberate order of the design (S124), not the alphabetical order the host sends', () => {
    expect(model.pages.map((page) => page.id)).toEqual(['appearance', 'general', 'editor', 'terminal', 'telemetry', 'developer']);
  });

  it('say what the host says: its label, its description and its glyph name', () => {
    expect(model.pages.find((page) => page.id === 'developer')).toMatchObject({ title: 'Developer Settings', description: 'Settings for developing or writing plugins within Omniview', icon: 'LuBeaker' });
  });

  it('put a category the table does not know after the known ones, by label, and never lose it', () => {
    const snapshot: HostSnapshot = { categories: { ...REAL.categories, zeta: category('zeta', 'Zeta', '', '', [setting('on', 'toggle', 'On', '', true)]), alpha: category('alpha', 'Alpha', '', '', [setting('on', 'toggle', 'On', '', true)]) } };
    expect(modelOf(snapshot).pages.map((page) => page.id)).toEqual(['appearance', 'general', 'editor', 'terminal', 'telemetry', 'developer', 'alpha', 'zeta']);
  });

  it('list the settings of a category by id, as the host sends them and the old window drew them', () => {
    expect(model.pages.find((page) => page.id === 'terminal')?.fields).toEqual(['terminal.bell', 'terminal.copyOnSelect', 'terminal.cursorBlink', 'terminal.cursorBlinkNext', 'terminal.cursorStyle', 'terminal.defaultShell', 'terminal.fontFamily', 'terminal.fontSize', 'terminal.gpuAcceleration', 'terminal.lineHeight', 'terminal.macOptionIsMeta', 'terminal.multiLinePasteWarning', 'terminal.scrollback', 'terminal.shellIntegration', 'terminal.theme']);
  });

  it('draw the opt-out of the shell integration as a switch that is on until it is turned off: a toggle the host declares in the terminal category', () => {
    expect(model.schema.sections.find((section) => section.id === 'terminal')?.fields.find((field) => field.id === 'terminal.shellIntegration')).toMatchObject({ kind: 'boolean', label: 'Shell Integration', default: true });
    expect(model.initial['terminal.shellIntegration']).toBe(true);
  });

  it('are sections of one schema, and the schema compiles with nothing left out', () => {
    const compiled = compileSchema(model.schema);
    expect(compiled.ok).toBe(true);
    expect(compiled.ok ? compiled.problems : []).toEqual([]);
    expect(model.schema.sections.map((section) => section.id)).toEqual(model.pages.map((page) => page.id));
  });

  it('have no page without a field: a category whose settings cannot be drawn is not offered', () => {
    const only = category('custom', 'Custom', '', '', [setting('x', 'color', 'Colour', '', '#fff')]);
    expect(modelOf({ categories: { custom: only } }).pages).toEqual([]);
  });
});

describe('a field is the id a commit takes, and its kind follows what the host declares', () => {
  it('is category.setting', () => {
    expect(model.pages.flatMap((page) => page.fields).every((id) => /^[a-z]+\.[A-Za-z_]+$/.test(id))).toBe(true);
    expect(fieldOf('editor.fontSize')).toBeDefined();
  });

  it('draws text with options as a select, with the host\'s words', () => {
    expect(kindOf('general.language')).toBe('select');
    expect(fieldOf('general.language')?.options).toEqual([
      { value: 'en', label: 'English', description: '' },
      { value: 'es', label: 'Spanish', description: '' },
    ]);
  });

  it('draws a whole number as a number that must be whole, and a toggle as a boolean', () => {
    expect(fieldOf('editor.fontSize')).toMatchObject({ kind: 'number', constraints: { integer: true } });
    expect(kindOf('editor.folding')).toBe('boolean');
  });

  it('draws a float as a number that may have a fraction', () => {
    const one = modelOf({ categories: { x: category('x', 'X', '', '', [setting('ratio', 'float', 'Ratio', '', 1.5)]) } });
    const field = one.schema.sections[0]?.fields[0];
    expect(field).toMatchObject({ kind: 'number' });
    expect(field?.constraints?.integer).toBeUndefined();
  });

  it('renders only the four declared surface percentages as bounded sliders, not remotely checked typed numbers', () => {
    for (const [key, value] of [['chromeOpacity', 62], ['contentOpacity', 94], ['menuOpacity', 90], ['sheetOpacity', 96]] as const) {
      const field = fieldOf(`appearance.${key}`);
      expect(field).toMatchObject({ kind: 'number', display: 'slider', unit: '%', constraints: { integer: true, min: 0, max: 100, step: 1 }, default: value });
      expect(field?.validate).toBeUndefined();
    }

    expect(fieldOf('terminal.fontSize')?.display).toBeUndefined();
  });

  it('does not synthesize material settings in hosts that do not declare them', () => {
    const appearance = category('appearance', 'Appearance', 'Host appearance', '', [setting('density', 'text', 'Density', '', 'compact')]);
    const older = modelOf({ categories: { appearance } });
    expect(older.pages[0]).toMatchObject({ description: 'Host appearance', fields: ['appearance.density'] });
    expect(older.schema.sections[0]?.fields).toHaveLength(1);
  });

  it('draws text that picks a file as a path, in the code face, and plain text as text', () => {
    expect(fieldOf('developer.gopath')).toMatchObject({ kind: 'path', mono: true, constraints: { pathKind: 'file' } });
    expect(kindOf('developer.marketplace_url')).toBe('text');
    expect(fieldOf('developer.marketplace_url')?.mono).toBeUndefined();
  });

  it('says a folder when the host allows folders', () => {
    const folder = setting('dir', 'text', 'Folder', '', '', { fileSelection: { enabled: true, allowFolders: true, multiple: false, relative: false, extensions: [] } });
    expect(modelOf({ categories: { x: category('x', 'X', '', '', [folder]) } }).schema.sections[0]?.fields[0]).toMatchObject({ kind: 'path', constraints: { pathKind: 'directory' } });
  });

  it('carries the label, the description as help, the default and a restart', () => {
    expect(fieldOf('developer.pprof_port')).toMatchObject({
      label: 'Host profiling port',
      help: 'Local pprof port after restarting Omniview. Use 0 to select an available port.',
      default: 6060,
      restart: true,
    });
    expect(fieldOf('developer.show_feature_channels')?.restart).toBeUndefined();
  });

  it('is asked of the host when it is typed (text, path, number) and never when it is chosen', () => {
    expect(fieldOf('developer.pprof_port')?.validate).toEqual({ remote: 'host' });
    expect(fieldOf('developer.gopath')?.validate).toEqual({ remote: 'host' });
    expect(fieldOf('developer.marketplace_url')?.validate).toEqual({ remote: 'host' });
    expect(fieldOf('editor.folding')?.validate).toBeUndefined();
    expect(fieldOf('general.language')?.validate).toBeUndefined();
    expect(fieldOf('telemetry.auth_value')?.validate).toBeUndefined();
  });
});

describe('what is not drawn, and why', () => {
  const reason = (id: string): string | undefined => model.notDrawn.find((entry) => entry.id === id)?.reason;

  it('offers the theme as a choice of colors, then layout, followed by the declared material fields', () => {
    expect(fieldOf('appearance.theme')).toMatchObject({ kind: 'text', display: 'theme-picker', default: 'void', help: 'The color theme for the application UI' });
    expect(fieldOf('appearance.theme')?.validate).toBeUndefined();
    expect(fieldOf('appearance.density')).toMatchObject({ kind: 'select', display: 'segmented' });
    expect(fieldOf('appearance.textSize')).toMatchObject({ kind: 'select', display: 'slider', default: '100' });
    expect(fieldOf('appearance.motion')).toMatchObject({ kind: 'select', display: 'segmented' });
    expect(model.pages.find((page) => page.id === 'appearance')?.fields).toEqual([
      'appearance.theme', 'appearance.density', 'appearance.textSize', 'appearance.motion',
      'appearance.windowMaterial', 'appearance.glassStyle', 'appearance.chromeOpacity', 'appearance.contentOpacity', 'appearance.menuOpacity', 'appearance.sheetOpacity',
    ]);
  });

  it('still omits the native terminal application until its discovery-backed picker exists', () => {
    expect(Object.keys(NOT_DRAWN)).toEqual(['terminal.nativeApplication']);
    expect(kindOf('terminal.nativeApplication')).toBeUndefined();
    expect(reason('terminal.nativeApplication')).toBe('picker');
  });

  it('leaves out a setting that is for developers: none of the host\'s core settings is, and no flag says developer mode is on here', () => {
    const dev = setting('hidden', 'toggle', 'Hidden', '', false, { devOnly: true });
    const one = modelOf({ categories: { x: category('x', 'X', '', '', [dev, setting('shown', 'toggle', 'Shown', '', false)]) } });
    expect(one.pages[0]?.fields).toEqual(['x.shown']);
    expect(one.notDrawn).toContainEqual({ id: 'x.hidden', reason: 'developer' });
  });

  it('leaves out a type this slice has no part for (multiselect, colour, date and time) and one it does not know', () => {
    const settings = [
      setting('a', 'multiselect', 'A', '', [], { options: [{ value: 'x', label: 'X' }] }),
      setting('b', 'color', 'B', '', '#ffffff'),
      setting('c', 'datetime', 'C', '', ''),
      setting('d', 'quaternion', 'D', '', ''),
      setting('e', 'toggle', 'E', '', true),
    ];
    const one = modelOf({ categories: { x: category('x', 'X', '', '', settings) } });
    expect(one.pages[0]?.fields).toEqual(['x.e']);
    expect(one.notDrawn.map((entry) => [entry.id, entry.reason])).toEqual([
      ['x.a', 'type'],
      ['x.b', 'type'],
      ['x.c', 'type'],
      ['x.d', 'type'],
    ]);
  });

  it('leaves out an option whose value is not a text, a number or a switch, and a select with none left is plain text', () => {
    const odd = setting('mode', 'text', 'Mode', '', 'a', { options: [{ value: { x: 1 }, label: 'Object' }] });
    expect(modelOf({ categories: { x: category('x', 'X', '', '', [odd]) } }).schema.sections[0]?.fields[0]).toMatchObject({ kind: 'text' });
  });
});

describe('secrets: drawn from the host\'s own fact that one is stored, and from nothing else', () => {
  it('draws a sensitive setting as a secret, with no value and no default', () => {
    expect(fieldOf('telemetry.auth_value')).toMatchObject({ kind: 'secret', sensitive: true, label: 'OTLP Traces and Metrics Auth Value' });
    expect(fieldOf('telemetry.auth_value')?.default).toBeUndefined();
    expect(model.initial['telemetry.auth_value']).toBeUndefined();
  });

  it('says for each whether one is saved, from the snapshot\'s stored fact', () => {
    expect(model.presence).toEqual({ 'telemetry.auth_value': true, 'telemetry.loki_auth_value': false, 'telemetry.otlp_logs_auth_value': false });
  });

  it('does not draw a secret the host does not say anything about: it would be a guess (a host older than the fact)', () => {
    const old: HostSnapshot = { categories: REAL.categories };
    const one = modelOf(old);
    expect(one.pages.find((page) => page.id === 'telemetry')?.fields).not.toContain('telemetry.auth_value');
    expect(one.notDrawn).toContainEqual({ id: 'telemetry.auth_value', reason: 'presence' });
    expect(one.presence).toEqual({});
  });

  it('never holds a value of a secret, whatever the snapshot carries by mistake', () => {
    const leaky = hostSnapshot({}, { 'telemetry.auth_value': true });
    const category = leaky.categories.telemetry;
    const sneaky = { ...leaky, categories: { ...leaky.categories, telemetry: { ...category!, settings: { ...category!.settings, auth_value: { ...category!.settings.auth_value!, value: 'sk-live-SENTINEL', default: 'sk-live-SENTINEL' } } } } };
    expect(JSON.stringify(modelOf(sneaky))).not.toContain('sk-live-SENTINEL');
  });
});

describe('the values', () => {
  it('start from the host\'s values, by id', () => {
    const one = modelOf(hostSnapshot({ 'editor.fontSize': 14, 'terminal.defaultShell': '/bin/bash', 'telemetry.enabled': true }));
    expect(one.initial['editor.fontSize']).toBe(14);
    expect(one.initial['terminal.defaultShell']).toBe('/bin/bash');
    expect(one.initial['telemetry.enabled']).toBe(true);
    expect(one.initial['editor.folding']).toBe(true);
  });

  it('say which settings wait for a restart, from the host', () => {
    const snapshot = hostSnapshot();
    const developer = snapshot.categories.developer!;
    const marked: HostSnapshot = { ...snapshot, categories: { ...snapshot.categories, developer: { ...developer, settings: { ...developer.settings, pprof_port: { ...developer.settings.pprof_port!, pendingRestart: true } } } } };
    expect(modelOf(marked).pendingRestart).toEqual(['developer.pprof_port']);
    expect(modelOf(snapshot).pendingRestart).toEqual([]);
  });

  it('keep a value of the wrong type out of the form rather than guessing: the field starts from its default', () => {
    const wrong = hostSnapshot({ 'editor.fontSize': 'big' });
    expect(modelOf(wrong).initial['editor.fontSize']).toBeUndefined();
  });
});

describe('a plugin snapshot', () => {
  const scope = { kind: 'plugin', pluginId: 'profile.a' } as const;

  it('uses the opaque map key, not the category or a separately declared id, without host-only presentations', () => {
    const ordinary = setting('not-the-key', 'text', 'Provider theme', '', 'local');
    const plugin = { ...category('plugin', 'Plugin', '', '', []), settings: {
      'appearance.theme': ordinary, 'terminal.nativeApplication': ordinary, 'limits.cpu.soft': { ...ordinary, label: '' },
    } };
    const one = modelOf({ categories: { plugin } }, scope);
    expect(one.pages).toHaveLength(1);
    expect(one.pages[0]?.fields).toEqual(['appearance.theme', 'limits.cpu.soft', 'terminal.nativeApplication']);
    expect(one.schema.sections[0]?.fields[0]).toMatchObject({ kind: 'text', validate: { remote: 'host' } });
    expect(one.schema.sections[0]?.fields[0]?.display).toBeUndefined();
    expect(one.schema.sections[0]?.fields[1]?.label).toBe('limits.cpu.soft');
    expect(one.initial).toEqual({ 'appearance.theme': 'local', 'terminal.nativeApplication': 'local', 'limits.cpu.soft': 'local' });
  });

  it('preserves text arrays, including an empty multi-file picker, and never exposes mixed or sensitive arrays as text', () => {
    const fileSelection = { enabled: true, multiple: true, allowFolders: false, relative: false };
    const paths = setting('contexts.files', 'text', 'Configuration files', '', [], { fileSelection });
    const list = setting('labels', 'text', 'Labels', '', ['one', 'two']);
    const plugin = category('plugin', 'Plugin', '', '', [paths, list,
      { ...paths, id: 'mixed', value: [false] },
      { ...list, id: 'secret', sensitive: true, value: ['secret-array-marker'] }]);
    const one = modelOf({ categories: { plugin } }, scope);
    expect(one.pages[0]?.fields).toEqual(['contexts.files', 'labels']);
    expect(one.schema.sections[0]?.fields[0]).toMatchObject({ kind: 'list', mono: true, constraints: { item: 'path' }, default: [] });
    expect(one.initial).toEqual({ 'contexts.files': [], labels: ['one', 'two'] });
    expect(JSON.stringify(one)).not.toContain('secret-array-marker');
  });

  it('discards sensitive values, defaults, options and file metadata; it never invents a stored fact', () => {
    const marker = 'never-send-this-to-search';
    const leaky = { ...setting('token', 'text', 'API key', '', ''), value: marker, default: marker, sensitive: true,
      options: [{ value: marker, label: marker }], fileSelection: { enabled: true, allowFolders: false, extensions: [marker], multiple: false, relative: false } };
    const plugin = category('plugin', 'Plugin', '', '', [leaky, { ...leaky, type: 'password', sensitive: false, id: 'password' },
      { ...leaky, type: 'integer', id: 'pin', value: 123456, default: 123456 }]);
    const one = modelOf({ categories: { plugin } }, scope);
    expect(one.pages).toEqual([]);
    expect(one.initial).toEqual({});
    expect(one.presence).toEqual({});
    expect(JSON.stringify(one)).not.toContain(marker);
    expect(JSON.stringify(one)).not.toContain('123456');
  });
});
