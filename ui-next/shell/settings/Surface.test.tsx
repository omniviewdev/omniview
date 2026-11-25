import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, SENTINEL } from '../core/fields/testing';
import { hostSnapshot } from './model/testing';
import type { HostSnapshot } from './model/types';
import { mount, settle, teardown, type Mounted } from './testing';
import { Body } from './view/Body';
import * as words from './view/words';

// The Settings sheet over the real session, the real form model and the real kit parts, with a host that answers from memory. These tests read what a person reads: which pages there are, which control each setting has, what a
// change does, what the lane says. jsdom has no layout and no top layer: the geometry and the modal's own behaviour are the probe's (probes/settings-probe.mjs).

vi.mock('./view/words', async (importOriginal) => {
  const actual = await importOriginal<typeof words>();
  return { ...actual, laneOf: vi.fn(actual.laneOf) };
});

afterEach(teardown);

const pageButtons = (): string[] => within(screen.getByRole('navigation', { name: 'Settings pages' })).getAllByRole('button').map((button) => button.textContent ?? '');

async function goTo(m: Mounted, title: string): Promise<void> {
  await m.user.click(within(screen.getByRole('navigation', { name: 'Settings pages' })).getByRole('button', { name: title }));
}

describe('the sheet', () => {
  it('is a dialog named Settings, loading first with nothing to change and a Close that works', async () => {
    const gate = deferred<HostSnapshot>();
    const m = await mount({ first: async () => gate.promise });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    await m.user.click(screen.getByRole('button', { name: 'Close' }));
    expect(m.onClose).toHaveBeenCalledTimes(1);
    gate.resolve(hostSnapshot());
    await settle(m.clock);
    expect(screen.getByRole('navigation', { name: 'Settings pages' })).toBeInTheDocument();
  });

  it('asks the browser to close it with Escape through the dialog\'s own cancel event, and never by itself', async () => {
    const m = await mount();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(m.onClose).not.toHaveBeenCalled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the pages, by the keyboard', () => {
  it('follow the focus: an arrow moves to a page and shows it, and Home and End do the same', async () => {
    const m = await mount();
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveFocus();
    await m.user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'General' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument();
    await m.user.keyboard('{End}');
    expect(screen.getByRole('region', { name: 'Developer Settings' })).toBeInTheDocument();
    await m.user.keyboard('{Home}');
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    expect(m.page.last()).toBe('appearance');
  });
});

describe('the pages', () => {
  it('are the host\'s categories in the design\'s order, as one named navigation of buttons, the first on screen', async () => {
    await mount();
    expect(pageButtons()).toEqual(['Appearance', 'General', 'Editor', 'Terminal', 'Telemetry', 'Developer Settings']);
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByText('Customize the look and feel of the application')).toBeInTheDocument();
  });

  it('draw the glyph the host names for each category, now that the kit has all six, in a column of their own', async () => {
    await mount();
    const buttons = within(screen.getByRole('navigation', { name: 'Settings pages' })).getAllByRole('button');
    expect(buttons.map((button) => button.querySelector('svg')?.getAttribute('data-ov-glyph'))).toEqual(['paintbrush', 'settings-2', 'code', 'square-terminal', 'activity', 'beaker']);
    expect(buttons.map((button) => button.querySelectorAll('svg').length)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('put the keyboard on the page that is on screen when the sheet is ready', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveFocus();
  });

  it('change by pressing one, show that page and remember it for the next opening', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Appearance' })).toBeNull();
    expect(m.page.last()).toBe('terminal');
  });

  it('start on the page that was left, when it is still there', async () => {
    await mount({ page: 'editor' });
    expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
  });

  it('do not offer a setting the sheet has no part for, nor a page left empty by that', async () => {
    await mount();
    // Appearance has a theme in the host's schema; its editor is a picker, which is not built: three rows, not four.
    expect(screen.queryByRole('textbox', { name: 'Theme' })).toBeNull();
    const rows = document.querySelectorAll('[data-settings-row]');
    expect([...rows].map((row) => row.getAttribute('data-settings-row'))).toEqual(['appearance.density', 'appearance.motion', 'appearance.textSize']);
  });
});

describe('each setting has the control its kind asks for', () => {
  it('a choice is a select with the host\'s options, a switch is a switch, a whole number a spinbutton, a text a field', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Cursor Style' })).toHaveValue('block');
    expect(within(screen.getByRole('combobox', { name: 'Cursor Style' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Block', 'Underline', 'Bar']);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('12');
    expect(screen.getByRole('textbox', { name: 'Default Shell' })).toHaveValue('/bin/zsh');
  });

  it('says what the host says of each: the description is the control\'s description', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAccessibleDescription(/Whether the cursor should blink in the terminal/);
  });

  it('a secret says whether the host holds one, never what it is', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true } });
    await goTo(m, 'Telemetry');
    expect(screen.getByLabelText('OTLP Traces and Metrics Auth Value')).toHaveAttribute('placeholder', 'Saved · hidden');
    expect(screen.getByLabelText('Loki Auth Value')).toHaveAttribute('placeholder', 'Not set');
    expect(screen.getByLabelText('OTLP Traces and Metrics Auth Value')).toHaveValue('');
  });
});

describe('a change', () => {
  it('applies when a switch is pressed: the host is told the one setting, and the row says it differs from the default', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
    await m.user.click(screen.getByRole('switch', { name: 'Cursor Blink' }));
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'terminal.cursorBlink': false }]);
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Reset Cursor Blink to default' }).querySelector('svg')).toHaveAttribute('data-ov-glyph', 'rotate-ccw');
  });

  it('is undone by Reset, which then goes, and the keyboard is on the row\'s control', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    await m.user.click(screen.getByRole('switch', { name: 'Cursor Blink' }));
    await settle(m.clock);
    await m.user.click(screen.getByRole('button', { name: 'Reset Cursor Blink to default' }));
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'terminal.cursorBlink': false }, { 'terminal.cursorBlink': true }]);
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveFocus();
  });

  it('applies a choice at once and never asks the host about it first', async () => {
    const m = await mount();
    await m.user.selectOptions(screen.getByRole('combobox', { name: 'UI Density' }), 'compact');
    await settle(m.clock);
    expect(m.host.calls.validate).toEqual([]);
    expect(m.host.calls.commit).toEqual([{ 'appearance.density': 'compact' }]);
  });

  it('is committed on Enter for a typed value, after the host has been asked about it, and says Saved', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('textbox', { name: 'Default Shell' });
    await m.user.clear(field);
    await m.user.type(field, '/bin/fish');
    expect(m.host.calls.commit).toEqual([]);
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(m.host.calls.validate).toEqual([['terminal.defaultShell', '/bin/fish']]);
    expect(m.host.calls.commit).toEqual([{ 'terminal.defaultShell': '/bin/fish' }]);
    expect(field).toHaveAccessibleDescription(/Saved\./);
    await act(async () => {
      await m.clock.advance(2_000);
    });
    expect(field).not.toHaveAccessibleDescription(/Saved\./);
  });

  it('is refused in the host\'s words, keeps what was typed, is announced once, and applies nothing', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    m.host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    const field = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(field);
    await m.user.type(field, '70000');
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(field).toHaveValue('70000');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/Enter a whole-number port from 0 to 65535\./);
    expect(m.host.calls.commit).toEqual([]);
    expect(screen.getAllByRole('status').some((region) => region.textContent === 'Host profiling port: Enter a whole-number port from 0 to 65535.')).toBe(true);
  });

  it('does not keep a refused draft for the way back: the page is entered from what the host applied (S125, no draft outlives its field)', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    m.host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    const refused = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(refused);
    await m.user.type(refused, '70000');
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(refused).toHaveAttribute('aria-invalid', 'true');
    await goTo(m, 'Terminal');
    await goTo(m, 'Developer Settings');
    const back = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    expect(back).toHaveValue('6060');
    expect(back).not.toHaveAttribute('aria-invalid', 'true');
    expect(m.host.calls.commit).toEqual([]);
  });

  it('puts the applied value back on Escape in a field that has a draft, and the sheet stays open', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('spinbutton', { name: 'Font Size' });
    await m.user.clear(field);
    await m.user.type(field, '30');
    await m.user.keyboard('{Escape}');
    expect(field).toHaveValue('12');
    expect(m.onClose).not.toHaveBeenCalled();
  });

  it('keeps the characters a person types into a number: "1." stays "1." while it is being typed', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    const field = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(field);
    await m.user.type(field, '6061.');
    expect(field).toHaveValue('6061.');
  });
});

describe('the cost of a keystroke', () => {
  it('draws the one row that has it: a key typed in a field is one row\'s render and no other row\'s', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    const field = screen.getByRole('textbox', { name: 'Marketplace URL' });
    const laneOf = vi.mocked(words.laneOf);
    laneOf.mockClear();
    await m.user.type(field, 'x');
    // One keystroke: the row of that field draws; its ten neighbours do not.
    expect(laneOf.mock.calls.length).toBe(1);
  });
});

describe('a change made elsewhere', () => {
  it('moves a field that has no draft', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    act(() => {
      m.host.change('terminal.fontSize', 16);
    });
    await settle(m.clock);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('16');
  });

  it('leaves what a person is typing and says so on the field; Escape takes the other value', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('spinbutton', { name: 'Font Size' });
    await m.user.clear(field);
    await m.user.type(field, '18');
    act(() => {
      m.host.change('terminal.fontSize', 16);
    });
    await settle(m.clock);
    expect(field).toHaveValue('18');
    expect(field).toHaveAccessibleDescription(/Changed elsewhere to “16”\. Escape takes it\./);
    await m.user.keyboard('{Escape}');
    expect(field).toHaveValue('16');
    expect(field).not.toHaveAccessibleDescription(/Changed elsewhere/);
  });
});

describe('a secret', () => {
  it('is sent as typed, once, and then the row says one is saved; the typed value is in no node, attribute or message of the page', async () => {
    const m = await mount();
    await goTo(m, 'Telemetry');
    const field = screen.getByLabelText('Loki Auth Value');
    await m.user.type(field, SENTINEL);
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'telemetry.loki_auth_value': SENTINEL }]);
    expect(screen.getByLabelText('Loki Auth Value')).toHaveAttribute('placeholder', 'Saved · hidden');
    expect(screen.getByLabelText('Loki Auth Value')).toHaveValue('');
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL);
    expect(m.session.announcements.getSnapshot().text).not.toContain(SENTINEL);
  });
});

describe('a sheet that cannot load', () => {
  it('says so, offers Retry with the keyboard on it, and Retry asks the host again', async () => {
    const m = await mount({ first: async () => Promise.reject(new Error('down')) });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load settings');
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    await m.user.click(screen.getByRole('button', { name: 'Retry' }));
    await settle(m.clock);
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(m.host.calls.snapshot).toBe(2);
  });
});

describe('a page that was not looking', () => {
  // The host's `settings/changed` is not replayed to a page whose events connection was down (server mode) or whose machine slept: it asks again when it is looked at.
  it.each([
    ['the window gets the focus again', () => window.dispatchEvent(new Event('focus'))],
    ['the page becomes visible', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['the machine is online again', () => window.dispatchEvent(new Event('online'))],
  ])('asks the host again when %s, and follows what it missed', async (_name, look) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const m = await mount();
    await goTo(m, 'Terminal');
    const before = m.host.calls.snapshot;
    m.host.values.set('terminal.fontSize', 20);
    act(() => {
      look();
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before + 1);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('20');
  });

  it('does not ask while it is hidden, and holds no listener once it is gone', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const m = await mount();
    const before = m.host.calls.snapshot;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before);
    visibility.mockReturnValue('visible');
    m.unmount();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before);
  });
});

describe('a secret the host refused', () => {
  it('is gone from the form when the page is left and come back to: the typed text never outlives its field', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true, 'telemetry.loki_auth_value': false } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    const { form } = state;
    m.host.next.commit = async () => Promise.reject(new Error('refused'));
    act(() => {
      form.setValue('telemetry.loki_auth_value', SENTINEL);
    });
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    await settle(m.clock);
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: true });
    expect(form.stats().secrets).toBe(1);
    await goTo(m, 'Editor');
    await goTo(m, 'Telemetry');
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: false });
    expect(form.stats().secrets).toBe(0);
    expect(document.body.innerHTML).not.toContain(SENTINEL);
  });
});

describe('a secret typed while the other window changes it', () => {
  it('says so on the field in words that carry no text', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    act(() => {
      state.form.setValue('telemetry.auth_value', SENTINEL);
    });
    await m.host.client.commit({ 'telemetry.auth_value': '' });
    m.host.change('telemetry.auth_value', '');
    await settle(m.clock);
    expect(screen.getByText(/Changed elsewhere\. Escape takes it\./)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SENTINEL);
  });
});

describe('a body that is mounted anew', () => {
  // The Settings window's body is keyed by the host's request: each request for a page mounts a new one over the same session and form. Whatever the way it comes, a secret that is being typed never outlives the body it was typed in.
  it('holds no secret text in the form: a refused secret is gone from the vault after any remount', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true, 'telemetry.loki_auth_value': false } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    const { form } = state;
    m.host.next.commit = async () => Promise.reject(new Error('refused'));
    act(() => {
      form.setValue('telemetry.loki_auth_value', SENTINEL);
    });
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    await settle(m.clock);
    expect(form.stats().secrets).toBe(1);
    m.unmount();
    render(<Body session={m.session} page={m.page} headingLevel="h2" />);
    await settle(m.clock);
    expect(form.stats().secrets).toBe(0);
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: false });
    expect(document.body.innerHTML).not.toContain(SENTINEL);
    // Enter in the field that reads empty sends nothing.
    const sent = m.host.calls.commit.length;
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    expect(m.host.calls.commit.length).toBe(sent);
  });
});
