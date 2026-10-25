import { expect, test } from '@playwright/test';
import { validateObservation, type Descriptor } from './workspace';

function selection() {
  const descriptor: Descriptor = {
    schemaVersion: 1, workspaceID: 'f14566c4-5130-4e3f-aa09-3e49c63b29a6', instanceID: 'f14566c4-5130-4e3f-aa09-3e49c63b29a6', generation: 'd5e5d608-40b6-4b07-9029-1f6881aeab28', kind: 'development', displayName: 'Observed', stateRoot: '/private/profile/state', readiness: 'host-ready',
    process: { pid: 123, startIdentity: 'kernel-start', executable: '/private/host', workspaceID: 'f14566c4-5130-4e3f-aa09-3e49c63b29a6', generation: 'd5e5d608-40b6-4b07-9029-1f6881aeab28', role: 'host', source: '/private/source' },
    endpoints: { browser: 'http://127.0.0.1:30000/', vite: null, hmr: null, control: 'http://127.0.0.1:30001/v1/control', mcp: null }, plugins: [],
  };
  return {
    descriptor,
    status: { manifest: { workspaceID: descriptor.workspaceID }, stateRoot: descriptor.stateRoot, launchPhase: 'ready', instance: structuredClone(descriptor) },
    response: { status: 'succeeded', workspaceID: descriptor.workspaceID, generation: descriptor.generation, result: structuredClone(descriptor) },
    expected: { workspaceID: descriptor.workspaceID, generation: descriptor.generation },
  };
}

test('read-only observation admits the exact authenticated UUID, process, generation and state', () => {
  const { descriptor, status, response, expected } = selection();
  expect(validateObservation(status, response, expected)).toEqual(descriptor);
});
for (const mutation of ['uuid', 'generation', 'state', 'process', 'endpoint', 'foreign endpoint', 'not ready'] as const) {
  test(`read-only observation refuses ${mutation} drift`, () => {
    const { status, response, expected } = selection();
    if (mutation === 'uuid') {
      expected.workspaceID = 'foreign';
    }

    if (mutation === 'generation') {
      expected.generation = 'foreign';
    }

    if (mutation === 'state') {
      response.result.stateRoot = '/foreign/state';
    }

    if (mutation === 'process') {
      response.result.process.startIdentity = 'different-start';
    }

    if (mutation === 'endpoint') {
      response.result.endpoints.control = 'http://127.0.0.1:31000/v1/control';
    }

    if (mutation === 'foreign endpoint') {
      response.result.endpoints.control = 'http://foreign.example:30001/v1/control';
      status.instance.endpoints.control = response.result.endpoints.control;
    }

    if (mutation === 'not ready') {
      status.launchPhase = 'starting';
    }

    expect(() => validateObservation(status, response, expected)).toThrow();
  });
}
