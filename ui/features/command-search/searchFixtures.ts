import type { ReadTarget, SearchScopeV1 } from '@omniviewdev/runtime';

export function searchType(type = 'pods', scope: ReadTarget['scope'] = []): Extract<SearchScopeV1, { kind: 'resource-type' }> {
  return {
    kind: 'resource-type', pluginId: 'probe', targetId: 'request-context', label: 'Pods',
    target: { route: { connection: 'prod' }, provider: 'probe', authority: 'host-test-authority', type, scope, representation: 'json' },
  };
}

export function searchResource(type = 'pods', id = 'api', scope = [{ dimension: 'namespace', value: 'apps' }]): Extract<SearchScopeV1, { kind: 'resource' }> {
  return {
    kind: 'resource', pluginId: 'probe', targetId: 'request-context', label: id,
    route: { connection: 'prod' }, representation: 'json',
    reference: { address: { provider: 'probe', authority: 'host-test-authority', type, id, scope } },
  };
}
