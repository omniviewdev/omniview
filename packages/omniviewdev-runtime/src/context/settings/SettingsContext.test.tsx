import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  values: vi.fn(),
}));

vi.mock('../../bindings/github.com/omniviewdev/omniview/internal/settings/servicewrapper', () => ({
  Values: mocks.values,
}));

import { useSettings } from '../../hooks/settings/useSettings';
import { SettingsProvider } from './SettingsContext';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Probe() {
  const { settings, reload } = useSettings();

  return (
    <>
      <output data-testid="settings">{JSON.stringify(settings)}</output>
      <button type="button" onClick={reload}>Reload</button>
    </>
  );
}

function renderProvider() {
  return render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>,
  );
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('settings').textContent ?? '{}');
}

describe('SettingsProvider request sequencing', () => {
  beforeEach(() => {
    mocks.values.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not let an older initial response overwrite a newer reload', async () => {
    const initial = createDeferred<Record<string, unknown>>();
    const reload = createDeferred<Record<string, unknown>>();
    mocks.values
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(reload.promise);
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    reload.resolve({ 'appearance.theme': 'light' });
    await act(async () => reload.promise);
    expect(readSettings()).toEqual({ 'appearance.theme': 'light' });

    initial.resolve({ 'appearance.theme': 'dark' });
    await act(async () => initial.promise);
    expect(readSettings()).toEqual({ 'appearance.theme': 'light' });
  });

  it('keeps the latest dark reload through an out-of-order light response in an ABA sequence', async () => {
    const initial = createDeferred<Record<string, unknown>>();
    const lightReload = createDeferred<Record<string, unknown>>();
    const darkReload = createDeferred<Record<string, unknown>>();
    mocks.values
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(lightReload.promise)
      .mockReturnValueOnce(darkReload.promise);
    renderProvider();

    initial.resolve({ 'appearance.theme': 'dark' });
    await act(async () => initial.promise);
    expect(readSettings()).toEqual({ 'appearance.theme': 'dark' });

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    darkReload.resolve({ 'appearance.theme': 'dark' });
    await act(async () => darkReload.promise);
    expect(readSettings()).toEqual({ 'appearance.theme': 'dark' });

    lightReload.resolve({ 'appearance.theme': 'light' });
    await act(async () => lightReload.promise);
    expect(readSettings()).toEqual({ 'appearance.theme': 'dark' });
  });

  it('reports an error only for the latest initiated request', async () => {
    const initial = createDeferred<Record<string, unknown>>();
    const reload = createDeferred<Record<string, unknown>>();
    mocks.values
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(reload.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    initial.reject(new Error('stale failure'));
    await act(async () => initial.promise.catch(() => undefined));
    expect(consoleError).not.toHaveBeenCalled();

    const latestError = new Error('latest failure');
    reload.reject(latestError);
    await act(async () => reload.promise.catch(() => undefined));
    expect(consoleError).toHaveBeenCalledWith('Error fetching settings:', latestError);
  });
});
