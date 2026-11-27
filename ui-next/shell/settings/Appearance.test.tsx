import { act, fireEvent, render, screen } from '@testing-library/react';
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
    const percentages = () => screen.getAllByRole<HTMLInputElement>('slider').map((input) => input.valueAsNumber);
    expect(screen.getAllByRole('slider').every((input) => input.getAttribute('aria-disabled') === 'true')).toBe(true);
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

  it('resets the six material preferences in one write, including inactive sliders, without resetting Interface', async () => {
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
    expect(screen.getByRole('combobox', { name: 'UI Density' })).toHaveValue('compact');
    expect(reset).toHaveAttribute('aria-disabled', 'true');
  });
});
