import { act, renderHook } from '@testing-library/react';
import type { ColumnVisibilityState } from '@tanstack/react-table';
import { afterEach, describe, expect, it } from 'vitest';

import { readProfileStorage, writeProfileStorage } from '@/features/instance/boot';
import { useColumnVisibilityPreference } from './useColumnVisibilityPreference';

const key = 'plugin-connection-widgets-column-visibility';

type Inputs = { storageKey: string; defaults: ColumnVisibilityState | undefined };

const show = (inputs: Inputs) => renderHook(
  ({ storageKey, defaults }: Inputs) => useColumnVisibilityPreference(storageKey, defaults),
  { initialProps: inputs },
);

afterEach(() => {
  localStorage.clear();
});

describe('column visibility preference', () => {
  it('shows the saved choices on the first render and adds columns declared since they were saved', () => {
    writeProfileStorage(key, JSON.stringify({ phase: false }));

    const { result } = show({ storageKey: key, defaults: { name: true, phase: true, owner: false } });

    // No effect has run yet: hidden columns never mount for a render.
    expect(result.current[0]).toEqual({ name: true, phase: false, owner: false });
  });

  it('starts from the declared defaults when nothing is saved, and ignores a damaged entry', () => {
    const defaults = { name: true, owner: false };
    expect(show({ storageKey: key, defaults }).result.current[0]).toEqual(defaults);

    writeProfileStorage(key, 'not json');
    expect(show({ storageKey: key, defaults }).result.current[0]).toEqual(defaults);

    writeProfileStorage(key, '["name"]');
    expect(show({ storageKey: key, defaults }).result.current[0]).toEqual(defaults);
  });

  it('shows every column when the provider declares none', () => {
    writeProfileStorage(key, JSON.stringify({ phase: false }));

    expect(show({ storageKey: key, defaults: undefined }).result.current[0]).toEqual({});
  });

  it('saves a choice to the profile and never saves an empty one', () => {
    const { result } = show({ storageKey: key, defaults: { name: true } });
    expect(JSON.parse(readProfileStorage(key) ?? 'null')).toEqual({ name: true });

    act(() => {
      result.current[1]({ name: true, phase: false });
    });

    expect(JSON.parse(readProfileStorage(key) ?? 'null')).toEqual({ name: true, phase: false });

    localStorage.clear();
    show({ storageKey: 'plugin-connection-other-column-visibility', defaults: {} });
    expect(readProfileStorage('plugin-connection-other-column-visibility')).toBeNull();
  });

  it('keeps what the user chose when the provider later declares more columns', () => {
    const { result, rerender } = show({ storageKey: key, defaults: { name: true, phase: true } });
    act(() => {
      result.current[1]({ name: true, phase: false });
    });

    rerender({ storageKey: key, defaults: { name: true, phase: true, owner: false } });

    expect(result.current[0]).toEqual({ name: true, phase: false, owner: false });
  });

  it('restores the choices of another table when its key changes', () => {
    const other = 'plugin-connection-gadgets-column-visibility';
    writeProfileStorage(other, JSON.stringify({ name: false }));
    const { result, rerender } = show({ storageKey: key, defaults: { name: true } });

    rerender({ storageKey: other, defaults: { name: true } });

    expect(result.current[0]).toEqual({ name: false });
  });
});
