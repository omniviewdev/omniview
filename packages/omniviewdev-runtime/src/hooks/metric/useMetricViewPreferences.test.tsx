import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MetricViewPreferences } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { useMetricViewPreferences } from './useMetricViewPreferences';

const storage = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper', () => ({
  GetMetricViewPreferences: storage.get,
  SaveMetricViewPreferences: storage.save,
}));

const generic = (): MetricViewPreferences => ({ version: 1, revision: 0, metric_ids: [], displays: {},
  layout: 'auto', time_mode: 'relative', duration_ms: 3_600_000, start_ms: 0, end_ms: 0, details: {} });
const defaults = { metric_ids: ['cpu', 'memory'], displays: { cpu: 'gauge' }, layout: 'grid',
  time_mode: 'absolute', duration_ms: 60_000, start_ms: 1000, end_ms: 61_000, details: { memory: true } };
let stored: MetricViewPreferences;
let scope = 0;
beforeEach(() => {
  scope++;
  stored = generic();
  storage.get.mockReset().mockImplementation(async () => structuredClone(stored));
  storage.save.mockReset().mockImplementation(async (_owner: string, _resource: string, next: MetricViewPreferences) => {
    if (next.revision !== stored.revision) throw new Error('Preference revision conflict');
    stored = structuredClone({ ...next, revision: next.revision + 1 });
  });
});
afterEach(cleanup);
const useView = () => useMetricViewPreferences('owner', `resource-${scope}`, defaults);

it('uses every owning-view default only before the first saved revision', async () => {
  const { result } = renderHook(useView);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.preferences).toEqual({ ...generic(), ...defaults });
  await act(async () => { await result.current.update({}); });
  expect(stored).toEqual({ ...generic(), ...defaults, revision: 1 });
});

it('preserves saved empty selection and saved presentation instead of restoring defaults', async () => {
  stored = { ...generic(), revision: 3, displays: { cpu: 'line' }, details: { memory: false } };
  const { result } = renderHook(useView);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.preferences).toEqual(stored);
  expect(result.current.preferences.metric_ids).toEqual([]);
});

it('composes rapid functional updates against successive persisted revisions', async () => {
  const { result } = renderHook(useView);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => {
    const first = result.current.update(current => ({ metric_ids: current.metric_ids.filter(id => id !== 'cpu') }));
    const second = result.current.update(current => ({ metric_ids: [...current.metric_ids, 'network'] }));
    await Promise.all([first, second]);
  });
  expect(result.current.preferences.metric_ids).toEqual(['memory', 'network']);
  expect(stored.metric_ids).toEqual(['memory', 'network']);
  expect(stored.revision).toBe(2);
});

it('shares saved settings with concurrent views and after remount', async () => {
  const first = renderHook(useView);
  const second = renderHook(useView);
  await waitFor(() => expect(first.result.current.isLoading).toBe(false));
  await act(async () => { await first.result.current.update({ metric_ids: [], layout: 'stack' }); });
  expect(second.result.current.preferences.metric_ids).toEqual([]);
  expect(second.result.current.preferences.layout).toBe('stack');
  first.unmount();
  second.unmount();
  const remounted = renderHook(useView);
  await waitFor(() => expect(remounted.result.current.preferences.revision).toBe(1));
  expect(remounted.result.current.preferences.metric_ids).toEqual([]);
  expect(remounted.result.current.preferences.layout).toBe('stack');
});

it('exposes load failures without losing owning defaults', async () => {
  const failure = new Error('Storage unavailable');
  storage.get.mockRejectedValue(failure);
  const { result } = renderHook(useView);
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.preferences.metric_ids).toEqual(defaults.metric_ids);
});

it('rejects failed saves, exposes errors across views, and permits a later explicit save', async () => {
  const first = renderHook(useView);
  const second = renderHook(useView);
  await waitFor(() => expect(first.result.current.isLoading).toBe(false));
  const failure = new Error('Preference revision conflict');
  storage.save.mockRejectedValueOnce(failure);
  await act(async () => {
    await expect(first.result.current.update({ metric_ids: [] })).rejects.toBe(failure);
  });
  expect(first.result.current.error).toBe(failure);
  expect(second.result.current.error).toBe(failure);
  expect(first.result.current.preferences.metric_ids).toEqual(defaults.metric_ids);
  await act(async () => { await second.result.current.update({ metric_ids: [] }); });
  expect(first.result.current.error).toBeNull();
  expect(first.result.current.preferences.metric_ids).toEqual([]);
});
