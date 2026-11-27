import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeHost, fakeWindows } from './model/testing';
import { mount, settle, teardown } from './testing';
import SettingsWindow from './window';

const capabilities = vi.hoisted(() => ({ glass: false, translucent: true, forcedOpaque: false }));
vi.mock('../../appearance', () => ({ useAppearanceCapabilities: () => capabilities }));

afterEach(() => {
  Object.assign(capabilities, { glass: false, translucent: true, forcedOpaque: false });
  teardown();
});

const range = (name: string) => screen.getByRole<HTMLInputElement>('slider', { name });
const drag = { pointerId: 4, isPrimary: true, pointerType: 'mouse', button: 0 };
const move = (input: HTMLInputElement, value: number) => fireEvent.input(input, { target: { value: String(value) } });

describe('Colors', () => {
  it('shows a preview from each built-in palette and checks only the saved ID', async () => {
    const m = await mount({ values: { 'appearance.theme': 'solarized-light' } });
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toHaveAccessibleDescription(/The color theme for the application UI/);
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map(radio => radio.value)).toEqual([
      'void', 'dark', 'light', 'obsidian', 'carbon', 'solarized-dark', 'solarized-light', 'high-contrast-dark', 'high-contrast-light',
    ]);
    for (const radio of radios) {
      expect(radio.closest('label')?.querySelector('[data-ov-theme]')).toHaveAttribute('data-ov-theme', radio.value);
    }

    const saved = within(group).getByRole('radio', { name: 'Solarized Light' });
    expect(saved).toHaveAccessibleDescription('Light');
    expect(within(group).getAllByRole('radio', { checked: true })).toEqual([saved]);
    expect(radios.filter(radio => radio.tabIndex === 0)).toEqual([saved]);
    expect(m.host.calls.commit).toEqual([]);
  });

  it('writes the chosen ID, supports keyboard selection, and returns focus to the host default on reset', async () => {
    const m = await mount();
    const group = within(screen.getByRole('radiogroup', { name: 'Theme' }));
    await m.user.click(group.getByRole('radio', { name: 'Carbon' }));
    await m.user.keyboard('{End}');
    await settle(m.clock);
    const last = group.getByRole('radio', { name: 'High Contrast Light' });
    expect(last).toBeChecked();
    expect(last).toHaveFocus();
    await m.user.click(last);
    await m.user.click(screen.getByRole('button', { name: 'Reset Theme to default' }));
    await settle(m.clock);
    const first = group.getByRole('radio', { name: 'Void' });
    expect(first).toBeChecked();
    expect(first).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Reset Theme to default' })).toBeNull();
    expect(m.host.calls.validate).toEqual([]);
    expect(m.host.calls.commit).toEqual([{ 'appearance.theme': 'carbon' }, { 'appearance.theme': 'high-contrast-light' }, { 'appearance.theme': 'void' }]);
  });

  it('keeps an unavailable saved theme visible until the host changes it or the user replaces it', async () => {
    const m = await mount({ values: { 'appearance.theme': 'extension/example' } });
    const group = within(screen.getByRole('radiogroup', { name: 'Theme' }));
    const unavailable = group.getByRole('radio', { name: 'Unavailable: extension/example' });
    expect(unavailable).toBeChecked();
    expect(unavailable).toBeDisabled();
    expect(group.getByRole('radio', { name: 'Void' })).not.toBeChecked();
    act(() => { m.host.change('appearance.theme', 'light'); });
    await settle(m.clock);
    expect(group.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(group.queryByRole('radio', { name: /Unavailable/ })).toBeNull();
    expect(m.host.calls.commit).toEqual([]);
  });

  it('restores the applied theme after a refused save and describes the error on the group', async () => {
    const m = await mount({ values: { 'appearance.theme': 'obsidian' } });
    m.host.next.commit = () => { throw new Error('disk unavailable'); };
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    await m.user.click(within(group).getByRole('radio', { name: 'Dark' }));
    await settle(m.clock);
    expect(within(group).getByRole('radio', { name: 'Obsidian' })).toBeChecked();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription(/error/i);
    await m.user.click(within(group).getByRole('radio', { name: 'Solarized Dark' }));
    await settle(m.clock);
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(m.host.values.get('appearance.theme')).toBe('solarized-dark');
  });

  it('keeps the saved theme when its reset is refused, and a later policy lock prevents any choice', async () => {
    const m = await mount({ values: { 'appearance.theme': 'light' } });
    m.host.next.commit = () => { throw new Error('disk unavailable'); };
    await m.user.click(screen.getByRole('button', { name: 'Reset Theme to default' }));
    await settle(m.clock);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    const ready = m.session.getState();
    if (ready.phase !== 'ready') {
      throw new Error('Settings not ready');
    }

    act(() => { ready.form.setFieldLock('appearance.theme', { source: 'managed', readonly: false, reason: 'Managed by policy.' }); });
    expect(group).toHaveAttribute('aria-disabled', 'true');
    expect(group).toHaveAccessibleDescription(/Managed by policy/);
    await m.user.click(within(group).getByRole('radio', { name: 'Void' }));
    expect(m.host.calls.commit).toEqual([{ 'appearance.theme': 'void' }]);
  });
});

describe('Layout and text', () => {
  it('uses the host options and labels for both segmented choices and sends just the changed value', async () => {
    const m = await mount();
    const density = within(screen.getByRole('radiogroup', { name: 'UI Density' }));
    const motion = within(screen.getByRole('radiogroup', { name: 'Motion' }));
    expect(density.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    expect(motion.getByRole('radio', { name: 'Follow System' })).toBeChecked();
    await m.user.click(density.getByRole('radio', { name: 'Compact' }));
    await m.user.click(motion.getByRole('radio', { name: 'Normal' }));
    await m.user.keyboard('{End}');
    await settle(m.clock);
    expect(motion.getByRole('radio', { name: 'Reduced' })).toBeChecked();
    await m.user.click(screen.getByRole('button', { name: 'Reset Motion to default' }));
    await settle(m.clock);
    expect(motion.getByRole('radio', { name: 'Follow System' })).toHaveFocus();
    expect(m.host.calls.commit).toEqual([
      { 'appearance.density': 'compact' }, { 'appearance.motion': 'normal' }, { 'appearance.motion': 'reduced' }, { 'appearance.motion': 'system' },
    ]);
  });

  it('shows all five percentage stops, submits the selected host string on release, and resets independently', async () => {
    const m = await mount({ values: { 'appearance.textSize': '90' } });
    const input = range('UI Text Size');
    expect([input.min, input.max, input.step, input.valueAsNumber]).toEqual(['0', '4', '1', 1]);
    expect(input).toHaveAttribute('aria-valuetext', '90%');
    expect(input).toHaveAccessibleDescription(/Terminal and code editor fonts stay unchanged/);
    expect([...input.closest('[data-ov-part=\"slider\"]')!.querySelectorAll('[data-ov-part=\"stops\"] > span')].map(mark => mark.textContent)).toEqual(['80%', '90%', '100%', '110%', '125%']);
    fireEvent.pointerDown(input, drag);
    move(input, 0);
    move(input, 3);
    move(input, 4);
    expect(input).toHaveAttribute('aria-valuetext', '125%');
    expect(m.host.calls.commit).toEqual([]);
    fireEvent.pointerUp(input, drag);
    await settle(m.clock);
    expect(m.host.values.get('appearance.textSize')).toBe('125');
    await m.user.click(screen.getByRole('button', { name: 'Reset UI Text Size to default' }));
    await settle(m.clock);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-valuetext', '100%');
    expect(m.host.calls.commit).toEqual([{ 'appearance.textSize': '125' }, { 'appearance.textSize': '100' }]);
  });

  it('does not change the saved size on a rejected adjustment or after a cancelled drag', async () => {
    const m = await mount();
    const input = range('UI Text Size');
    m.host.next.commit = () => { throw new Error('disk unavailable'); };
    move(input, 4);
    await settle(m.clock);
    expect(input).toHaveAttribute('aria-valuetext', '100%');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.pointerDown(input, drag);
    move(input, 0);
    act(() => { m.host.change('appearance.textSize', '110'); });
    await settle(m.clock);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.pointerUp(input, drag);
    expect(input).toHaveAttribute('aria-valuetext', '110%');
    expect(m.host.calls.commit).toEqual([{ 'appearance.textSize': '125' }]);
  });
});

describe('Window material', () => {
  it('keeps unavailable saved choices visible without relabelling the requested material', async () => {
    const m = await mount({ values: { 'appearance.windowMaterial': 'glass', 'appearance.glassStyle': 'clear' } });
    const material = screen.getByRole('combobox', { name: 'Material' });
    expect(material).toHaveValue('glass');
    expect(screen.getByRole('option', { name: 'Liquid Glass' })).toBeDisabled();
    const style = screen.getByRole('combobox', { name: 'Glass style' });
    expect(style).toHaveValue('clear');
    expect(style).toHaveAttribute('aria-disabled', 'true');
    expect(range('Content')).not.toHaveAttribute('aria-disabled');
    expect(m.host.calls.commit).toEqual([]);
  });

  it('unlocks style for supported glass, locks opacity for opaque and preserves the four percentages', async () => {
    capabilities.glass = true;
    const m = await mount();
    const material = screen.getByRole('combobox', { name: 'Material' });
    const style = screen.getByRole('combobox', { name: 'Glass style' });
    const surfaces = within(screen.getByRole('region', { name: 'Surface opacity' }));
    const percentages = () => surfaces.getAllByRole<HTMLInputElement>('slider').map((input) => input.valueAsNumber);
    expect(surfaces.getAllByRole('slider').every((input) => input.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(percentages()).toEqual([62, 94, 90, 96]);
    await m.user.selectOptions(material, 'glass');
    await settle(m.clock);
    expect(style).not.toHaveAttribute('aria-disabled');
    await m.user.selectOptions(style, 'clear');
    await m.user.selectOptions(material, 'opaque');
    await settle(m.clock);
    expect(style).toHaveAttribute('aria-disabled', 'true');
    expect(style).toHaveValue('clear');
    expect(percentages()).toEqual([62, 94, 90, 96]);
    expect(m.host.calls.commit).toEqual([{ 'appearance.windowMaterial': 'glass' }, { 'appearance.glassStyle': 'clear' }, { 'appearance.windowMaterial': 'opaque' }]);
  });

  it('honors a system opacity override without a preference write', async () => {
    capabilities.forcedOpaque = true;
    const m = await mount({ values: { 'appearance.windowMaterial': 'translucent', 'appearance.contentOpacity': 79 } });
    const input = range('Content');
    expect(input).toHaveAttribute('aria-disabled', 'true');
    expect(input.valueAsNumber).toBe(79);
    move(input, 20);
    expect(input.valueAsNumber).toBe(79);
    expect(m.host.calls.commit).toEqual([]);
  });

  it('previews in one slider and sends one changed integer only on release', async () => {
    const m = await mount({ values: { 'appearance.windowMaterial': 'translucent' } });
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('Settings not ready');
    }

    const before = state.form.getSnapshot();
    const input = range('Window chrome');
    fireEvent.pointerDown(input, drag);
    for (const value of [77, 100, 8, 0]) {
      move(input, value);
    }

    expect(input).toHaveAttribute('aria-valuetext', '0%');
    expect(state.form.getSnapshot()).toBe(before);
    expect(m.host.calls.commit).toEqual([]);
    fireEvent.pointerUp(input, drag);
    await settle(m.clock);
    expect(m.host.calls.validate).toEqual([]);
    expect(m.host.calls.commit).toEqual([{ 'appearance.chromeOpacity': 0 }]);
    expect(input.valueAsNumber).toBe(0);
  });

  it('takes the latest committed value on Escape during a drag, without closing Settings or sending a change', async () => {
    const m = await mount({ values: { 'appearance.windowMaterial': 'translucent' } });
    const input = range('In-app menus');
    fireEvent.pointerDown(input, drag);
    move(input, 22);
    act(() => {
      m.host.change('appearance.menuOpacity', 76);
    });
    await settle(m.clock);
    expect(input.valueAsNumber).toBe(22);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.pointerUp(input, drag);
    expect(input.valueAsNumber).toBe(76);
    expect(m.host.calls.commit).toEqual([]);
    expect(m.onClose).not.toHaveBeenCalled();
  });

  it('cancels an unfinished native-window gesture on host hide, even without a document visibility event', async () => {
    const host = fakeHost({ 'appearance.windowMaterial': 'translucent' });
    const windows = fakeWindows({ requestId: 1, target: '/settings?category=appearance', visible: true });
    render(<SettingsWindow client={host.client} windows={windows.client} />);
    const input = await screen.findByRole<HTMLInputElement>('slider', { name: 'Sheets and dialogs' });
    fireEvent.pointerDown(input, drag);
    move(input, 42);
    expect(input.valueAsNumber).toBe(42);
    await act(async () => {
      windows.emit({ ...windows.state, visible: false });
    });
    await act(async () => {
      windows.emit({ ...windows.state, visible: true });
    });
    fireEvent.pointerUp(document.body, drag);
    expect(range('Sheets and dialogs').valueAsNumber).toBe(96);
    expect(host.calls.commit).toEqual([]);
  });

  it('rolls a refused adjustment back and shows the error instead of presenting it as saved', async () => {
    const m = await mount({ values: { 'appearance.windowMaterial': 'translucent' } });
    m.host.next.commit = async () => {
      throw new Error('disk unavailable');
    };

    const input = range('Content');
    move(input, 40);
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'appearance.contentOpacity': 40 }]);
    expect(input.valueAsNumber).toBe(94);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    move(input, 100);
    await settle(m.clock);
    expect(input.valueAsNumber).toBe(100);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('resets the six material preferences in one write, including inactive sliders, without resetting layout', async () => {
    const m = await mount({ values: { 'appearance.contentOpacity': 48, 'appearance.glassStyle': 'clear', 'appearance.density': 'compact' } });
    const reset = screen.getByRole('button', { name: 'Reset material settings' });
    expect(range('Content')).toHaveAttribute('aria-disabled', 'true');
    await m.user.click(reset);
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{
      'appearance.windowMaterial': 'opaque', 'appearance.glassStyle': 'regular', 'appearance.chromeOpacity': 62,
      'appearance.contentOpacity': 94, 'appearance.menuOpacity': 90, 'appearance.sheetOpacity': 96,
    }]);
    expect(range('Content').valueAsNumber).toBe(94);
    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
    expect(reset).toHaveAttribute('aria-disabled', 'true');
  });
});
