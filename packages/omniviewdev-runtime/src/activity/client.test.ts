import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityClient } from './client';
import type { StartResourceActionRequest } from './types';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: native.invoke },
  Events: { On: native.listen },
}));
let activityClient: ActivityClient;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  // Reload the module to model a fresh document and its private producer capability.
  ({ activityClient } = await import('./client'));
});

describe('activity host bridge', () => {
  it('encodes the whole reviewed action request without losing integer or negative-zero intent', () => {
    const request: StartResourceActionRequest = {
      pluginID: 'opaque-provider',
      request: {
        route: { connection: 'connection' },
        action: 'run',
        input: {
          kind: 'map',
          value: {
            count: { kind: 'uint64', value: '18446744073709551615' },
            offset: { kind: 'double', value: -0 },
          },
        },
      },
      presentation: {
        title: 'Work',
        progress: {
          kind: 'units',
          current: '9007199254740993',
          total: '18446744073709551615',
          unit: 'bytes',
        },
      },
    };
    activityClient.startResourceAction(request);
    const [name, encoded] = native.invoke.mock.calls[0];
    expect(name).toBe(
      'github.com/omniviewdev/omniview/backend/pkg/activity.FrontendService.StartResourceAction',
    );
    expect(encoded).toContain('"value":"18446744073709551615"');
    expect(encoded).toContain('"kind":"double","value":-0');
    expect(JSON.parse(encoded).presentation.progress.current).toBe('9007199254740993');
  });

  it('shares an early producer capability with hydration and retains it across observer remounts', async () => {
    let next = 0;
    native.invoke.mockImplementation(async (name) =>
      name.endsWith('.Subscribe')
        ? { id: `session-${++next}`, snapshot: { revision: 0, records: [] } }
        : undefined,
    );
    const publish = activityClient.publishMessage({ presentation: { title: 'Early diagnostic' } });
    const initial = await activityClient.subscribe();
    await publish;
    await activityClient.unsubscribe(initial.id);
    const remounted = await activityClient.subscribe();
    expect(remounted.id).not.toBe(initial.id);
    await activityClient.heartbeat();
    await activityClient.beginTask({ presentation: { title: 'Task' } });
    await activityClient.reportTask({ id: 'task', presentation: { title: 'Progress' } });
    await activityClient.finishTask({ id: 'task', state: 'succeeded' });
    await activityClient.upsertAlert({
      key: 'rule',
      observedAt: '2026-11-03T00:00:00Z',
      presentation: { title: 'Alert' },
    });
    await activityClient.resolveAlert({ key: 'rule', observedAt: '2026-11-03T00:00:01Z' });
    for (const method of [
      'Heartbeat',
      'BeginTask',
      'ReportTask',
      'FinishTask',
      'PublishMessage',
      'UpsertAlert',
      'ResolveAlert',
    ]) {
      const call = native.invoke.mock.calls.find(([name]) => name.endsWith(`.${method}`));
      expect(call?.[1]).toBe(initial.id);
    }
  });

  it('drops an expired producer capability without replaying any mutation', async () => {
    let next = 0;
    native.invoke.mockImplementation(async (name) => {
      if (name.endsWith('.Heartbeat')) throw new Error('Producer lease expired');
      if (name.endsWith('.Subscribe'))
        return { id: `session-${++next}`, snapshot: { revision: 0, records: [] } };
      return undefined;
    });
    const old = await activityClient.subscribe();
    native.invoke.mockClear();
    await expect(activityClient.heartbeat()).rejects.toThrow('Producer lease expired');
    expect(native.invoke.mock.calls.every(([name]) => name.endsWith('.Heartbeat'))).toBe(true);
    const fresh = await activityClient.subscribe();
    await activityClient.publishMessage({ presentation: { title: 'New explicit notification' } });
    expect(fresh.id).not.toBe(old.id);
    const published = native.invoke.mock.calls.find(([name]) => name.endsWith('.PublishMessage'));
    expect(published?.[1]).toBe(fresh.id);
  });

  it('preserves exact Values embedded in every producer presentation', async () => {
    const presentation = {
      title: 'Precise action',
      actions: [
        {
          id: 'run',
          kind: 'resource-action' as const,
          label: 'Run',
          intent: {
            pluginID: 'p',
            request: {
              route: { connection: 'c' },
              action: 'run',
              input: {
                kind: 'map' as const,
                value: {
                  count: { kind: 'uint64' as const, value: '18446744073709551615' },
                  offset: { kind: 'double' as const, value: -0 },
                },
              },
            },
          },
        },
      ],
    };
    native.invoke.mockImplementation(async (name) =>
      name.endsWith('.Subscribe')
        ? { id: 'document', snapshot: { revision: 0, records: [] } }
        : undefined,
    );
    await activityClient.subscribe();
    native.invoke.mockClear();
    await activityClient.beginTask({ presentation });
    await activityClient.reportTask({ id: 'task', presentation });
    await activityClient.finishTask({ id: 'task', state: 'succeeded', presentation });
    await activityClient.publishMessage({ presentation });
    await activityClient.upsertAlert({
      key: 'rule',
      observedAt: '2026-11-03T00:00:00Z',
      presentation,
    });
    expect(native.invoke.mock.calls).toHaveLength(5);
    for (const [, , encoded] of native.invoke.mock.calls) {
      const input = JSON.parse(encoded).presentation.actions[0].intent.request.input.value;
      expect(input.count.value).toBe('18446744073709551615');
      expect(Object.is(input.offset.value, -0)).toBe(true);
    }
  });
});
