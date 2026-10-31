import type { SearchScopeV1 } from './types';
import { sameGraphNode } from '@omniviewdev/runtime';

export function scopeConnection(scope: SearchScopeV1): string {
  return scope.kind === 'connection' ? scope.connectionId
    : scope.kind === 'resource-type' ? scope.target.route.connection : scope.route.connection;
}

export function scopeType(scope: SearchScopeV1): string | undefined {
  return scope.kind === 'connection' ? undefined
    : scope.kind === 'resource-type' ? scope.target.type : scope.reference.address.type;
}

export function scopeDetails(scope: SearchScopeV1): string | undefined {
  if (scope.kind === 'connection') {
    return undefined;
  }

  return scope.kind === 'resource'
    ? scope.reference.address.scope.map(entry => `${entry.dimension}: ${entry.value}`).join(', ')
    : scope.target.scope.map(entry => `${entry.dimension}: ${entry.match === 'any' ? '*' : entry.values.join(', ')}`).join('; ');
}

/** UI filtering is not admission: the host independently validates every request. */
export function containsScope(parent: SearchScopeV1, target: SearchScopeV1): boolean {
  if (parent.pluginId !== target.pluginId || scopeConnection(parent) !== scopeConnection(target)) {
    return false;
  }

  if (parent.kind === 'connection') {
    return true;
  }

  if (target.kind === 'connection') {
    return false;
  }

  if (parent.kind === 'resource') {
    return target.kind === 'resource'
      && parent.representation === target.representation
      && sameGraphNode({ pluginId: parent.pluginId, reference: parent.reference, route: parent.route },
        { pluginId: target.pluginId, reference: target.reference, route: target.route });
  }

  const child = target.kind === 'resource-type' ? target.target : target.reference.address;
  if (parent.target.provider !== child.provider || parent.target.authority !== child.authority
    || parent.target.type !== child.type) {
    return false;
  }

  if (parent.target.representation !== (target.kind === 'resource-type' ? target.target.representation : target.representation)) {
    return false;
  }

  return parent.target.scope.every(constraint => {
    if (constraint.match === 'any') {
      return true;
    }

    if (target.kind === 'resource') {
      const value = target.reference.address.scope.find(entry => entry.dimension === constraint.dimension);
      return !!value && constraint.values.includes(value.value);
    }

    const other = target.target.scope.find(entry => entry.dimension === constraint.dimension);
    return other?.match === 'oneOf' && other.values.every(value => constraint.values.includes(value));
  });
}
