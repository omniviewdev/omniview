// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtensionPointRegistry, ExtensionProvider, SETTINGS_EDITOR_EXTENSION_POINT_ID, type SettingsEditorProps, type SettingsEditorV1 } from '@omniviewdev/runtime';
import { Setting } from '@omniviewdev/runtime/models';
import { PluginSettingEditor } from './index';
import { normalizeExtensionRegistration } from '../plugins/core/normalization';
import { validatePluginExports } from '../plugins/core/validation';

afterEach(cleanup);
const field = 'opaque.field.id';
function setup(value: unknown = '', owner = 'native') {
  const registry = new ExtensionPointRegistry();
  registry.addExtensionPoint<SettingsEditorV1>({ id: SETTINGS_EDITOR_EXTENSION_POINT_ID, pluginId: 'core', mode: 'multiple' });
  const store = registry.getExtensionPoint<SettingsEditorV1>(SETTINGS_EDITOR_EXTENSION_POINT_ID)!;
  const focus = vi.fn();
  const change = vi.fn();
  const register = (id: string, editor: SettingsEditorV1['editor'], plugin = 'native', settingId = field) => {
    store.register({
      id, plugin, label: '', value: { schemaVersion: 1, settingId, editor },
    }); 
  };

  const show = () => render(<ExtensionProvider registry={registry}><PluginSettingEditor pluginId={owner} settingId={field}
    setting={new Setting({ id: field, sensitive: true, value: 'stored-secret', default: 'default-secret' })}
    value={value} dirty inputId="input" labelledBy="label" describedBy="description" onChange={change} registerFocusTarget={focus}>
    <span>generic</span></PluginSettingEditor></ExtensionProvider>);
  return { registry, store, register, show, focus, change };
}

const Editor = ({ value, inputId, labelledBy, describedBy, registerFocusTarget }: SettingsEditorProps) =>
  <input id={inputId} aria-labelledby={labelledBy} aria-describedby={describedBy} ref={registerFocusTarget} value={String(value)} readOnly />;

describe('plugin settings editors', () => {
  it.each([false, 0, ''])('preserves draft %s and host accessibility', (value) => {
    const s = setup(value); s.register('editor', Editor); s.show();
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe(String(value));
    expect(input.id).toBe('input');
    expect(input.getAttribute('aria-labelledby')).toBe('label');
    expect(input.getAttribute('aria-describedby')).toBe('description');
    expect(s.focus).toHaveBeenCalledWith(input);
  });
  it('uses loader ownership and preserves opaque IDs', () => {
    const normalized = normalizeExtensionRegistration('native', { extensionPointId: SETTINGS_EDITOR_EXTENSION_POINT_ID,
      registration: { id: 'editor', plugin: 'foreign', label: '', value: { schemaVersion: 1, settingId: field, editor: Editor } } });
    expect(normalized.pluginId).toBe('native');
    expect(normalized.value).toMatchObject({ settingId: field });
    const s = setup(); s.register('foreign', Editor, 'foreign'); s.register('unknown', Editor, 'native', 'opaque'); s.show();
    expect(screen.getByText('generic')).toBeTruthy();
  });
  it('never targets host settings', () => {
    const s = setup('', 'core'); s.register('editor', Editor, 'core'); s.show();
    expect(screen.getByText('generic')).toBeTruthy();
  });
  it('rejects ambiguity and malformed versions at load time', () => {
    const contribution = { extensionPointId: SETTINGS_EDITOR_EXTENSION_POINT_ID, registration: { id: 'one', value: { schemaVersion: 1, settingId: field, editor: Editor } } };
    expect(() => validatePluginExports({ plugin: {}, extensionRegistrations: [contribution, contribution] })).toThrow('Duplicate settings editor');
    expect(() => validatePluginExports({ plugin: {}, extensionRegistrations: [{ ...contribution, registration: { value: { ...contribution.registration.value, schemaVersion: 2 } } }] })).toThrow('Invalid version 1');
    const s = setup(); s.register('one', Editor); s.register('two', Editor); s.show();
    expect(screen.getByText('generic')).toBeTruthy();
  });
  it('isolates crashes and recovers on reload, then unloads with focus cleanup', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const s = setup('draft');
      s.register('editor', () => {
        throw new Error('editor crash'); 
      }); s.show();
      expect(screen.getByText('generic')).toBeTruthy();
      await act(async () => {
        s.store.unregister('editor'); s.register('editor', Editor); 
      });
      expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('draft');
      await act(async () => {
        s.registry.removeContributions('native'); 
      });
      expect(screen.getByText('generic')).toBeTruthy();
      expect(s.focus).toHaveBeenLastCalledWith(null);
    } finally {
      log.mockRestore(); 
    }
  });
  it('exposes only authorized metadata and draft, not stored values', () => {
    const capture = vi.fn(); const s = setup('draft');
    s.register('editor', (props) => {
      capture(props); return <span>custom</span>; 
    }); s.show();
    const props = capture.mock.calls[0][0] as SettingsEditorProps;
    expect(props.value).toBe('draft');
    expect(props.setting).not.toHaveProperty('value');
    expect(props.setting).not.toHaveProperty('default');
    expect(props).not.toHaveProperty('commit');
  });
  it('keeps the focused editor mounted when an unrelated plugin registers another editor', async () => {
    const s = setup('draft');
    s.register('editor', Editor);
    s.show();
    const input = screen.getByRole('textbox');
    input.focus();
    await act(async () => {
      s.register('other-editor', Editor, 'other-plugin'); 
    });
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveFocus();
  });

  it('retains focus and the draft when the selected contribution is replaced', async () => {
    const focusedWindow = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      const s = setup('unsaved');
      s.register('editor', Editor);
      s.show();
      screen.getByRole('textbox').focus();
      const Replacement = ({ value, registerFocusTarget }: SettingsEditorProps) =>
        <input aria-label='Replacement editor' value={String(value)} readOnly ref={registerFocusTarget} />;
      await act(async () => {
        s.store.unregister('editor'); s.register('editor', Replacement); 
      });
      expect(screen.getByRole('textbox', { name: 'Replacement editor' })).toHaveValue('unsaved');
      expect(screen.getByRole('textbox', { name: 'Replacement editor' })).toHaveFocus();
    } finally {
      focusedWindow.mockRestore();
    }
  });

  it.each([false, true])('keeps lazy editor drafts and restores focus only while still in the field (moved: %s)', async (moved) => {
    const focusedWindow = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      const { promise, resolve } = Promise.withResolvers<{ default: React.ComponentType<SettingsEditorProps> }>();
      const LazyEditor = React.lazy(async () => promise);
      const contribution = { extensionPointId: SETTINGS_EDITOR_EXTENSION_POINT_ID,
        registration: { id: 'lazy', value: { schemaVersion: 1, settingId: field, editor: LazyEditor } } };
      // The same export that passes startup validation must remain usable by the host.
      validatePluginExports({ plugin: {}, extensionRegistrations: [contribution] });
      const s = setup();
      s.register('lazy', LazyEditor);
      function Host() {
        const [draft, setDraft] = React.useState<unknown>('unsaved');
        return <ExtensionProvider registry={s.registry}>
          <button>Elsewhere</button>
          <PluginSettingEditor pluginId='native' settingId={field}
            setting={new Setting({ id: field })} value={draft} dirty onChange={setDraft}
            inputId='lazy-input' labelledBy='lazy-label' describedBy='lazy-description'>
            <input aria-label='Generic editor' value={String(draft)} onChange={event => {
              setDraft(event.target.value); 
            }} />
          </PluginSettingEditor>
        </ExtensionProvider>;
      }

      render(<Host />);
      const generic = screen.getByRole('textbox', { name: 'Generic editor' });
      generic.focus();
      fireEvent.change(generic, { target: { value: 'typed while loading' } });
      if (moved) {
        screen.getByRole('button', { name: 'Elsewhere' }).focus();
      }

      // Accessible custom editors need not implement the optional focus registration.
      await act(async () => {
        resolve({ default: ({ value, onChange }) => <input aria-label='Resolved editor'
          value={String(value)} onChange={event => {
            onChange(event.target.value); 
          }} /> });
      });
      const resolved = screen.getByRole('textbox', { name: 'Resolved editor' });
      expect(resolved).toHaveValue('typed while loading');
      expect(moved ? screen.getByRole('button', { name: 'Elsewhere' }) : resolved).toHaveFocus();
      screen.getByRole('button', { name: 'Elsewhere' }).focus();
      await act(async () => {
        s.register('unrelated', Editor, 'other-plugin');
      });
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'Resolved editor' })).toBe(resolved);
    } finally {
      focusedWindow.mockRestore();
    }
  });
});
