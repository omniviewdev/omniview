import { describe, expect, it, vi } from 'vitest';
import { ExtensionPointStore } from '../types/extensions';
import { RESOURCE_EDITOR_EXTENSION_POINT, type ResourceEditorContext, type ResourceEditorContribution } from '../types/resource-editor';
import { matchesResourceEditor, resourceEditorPathContains, selectResourceEditor, validateResourceEditorContribution } from './resource-editor';

const editor: ResourceEditorContribution = {
  contractVersion: 1,
  label: 'Widget',
  targets: [{ group: 'example.io', version: 'v1', kind: 'Widget', resource: 'widgets', scope: 'Namespaced' }],
  intents: ['create', 'edit', 'inspect'],
  sections: [{ id: 'spec', label: 'Configuration' }],
  ownedPaths: [['spec']],
  component: () => null,
};
const context: ResourceEditorContext = {
  ...editor.targets[0]!, connectionID: 'connection', intent: 'edit',
  capabilities: { create: 'available', update: 'available', delete: 'denied', list: 'available', get: 'available', actions: {} },
  discovery: { status: 'available', features: {} }, schema: { status: 'unknown' },
};
const registration = (id: string, plugin: string) => ({ id, plugin, label: id, value: editor });

describe('resource editor applicability', () => {
  it('matches exact discovered plural, scope and version only', () => {
    expect(matchesResourceEditor(editor, context)).toBe(true);
    expect(matchesResourceEditor(editor, { ...context, resource: 'widget' })).toBe(false);
    expect(matchesResourceEditor(editor, { ...context, version: 'v2' })).toBe(false);
    expect(matchesResourceEditor(editor, { ...context, scope: 'Cluster' })).toBe(false);
    expect(matchesResourceEditor(editor, { ...context, discovery: { status: 'unknown', features: {} } })).toBe(false);
  });
  it('never treats unknown requirements as granted or empty schema as supported', () => {
    expect(matchesResourceEditor({ ...editor, requirements: { actions: ['execute'] } }, context)).toBe(false);
    expect(matchesResourceEditor({ ...editor, requirements: { features: ['controller'] } }, context)).toBe(false);
    expect(matchesResourceEditor({ ...editor, requirements: { schema: { paths: [['spec']] } } }, context)).toBe(false);
    expect(matchesResourceEditor({ ...editor, requirements: { capabilities: ['delete'] } }, context)).toBe(false);
  });
  it('preserves passive inspection without granting mutation capabilities', () => {
    expect(matchesResourceEditor(editor, { ...context, intent: 'inspect', capabilities: { ...context.capabilities, create: 'denied', update: 'denied' } })).toBe(true);
  });
  it('requires explicit choice for competing addons and preserves builtin precedence', () => {
    const builtin = registration('kubernetes/widget', 'kubernetes');
    const addon = registration('addon/widget', 'addon');
    const second = registration('other/widget', 'other');
    expect(selectResourceEditor([addon, second], context, { builtinPluginID: 'kubernetes' }).status).toBe('choose');
    expect(selectResourceEditor([addon, builtin], context, { builtinPluginID: 'kubernetes' })).toEqual({ status: 'selected', contribution: builtin });
    expect(selectResourceEditor([builtin, addon], context, { builtinPluginID: 'kubernetes', preferredID: addon.id })).toEqual({ status: 'selected', contribution: addon });
    expect(selectResourceEditor([builtin], { ...context, version: 'v2' }, { builtinPluginID: 'kubernetes' }).status).toBe('fallback');
  });
  it('does not grant sibling paths by string prefix', () => {
    expect(resourceEditorPathContains(['spec'], ['spec', 'replicas'])).toBe(true);
    expect(resourceEditorPathContains(['spec'], ['specFoo'])).toBe(false);
    expect(resourceEditorPathContains(['spec', 0], ['spec', '0'])).toBe(false);
  });
});

describe('resource editor registry admission', () => {
  it('rejects malformed and duplicate descriptors while retaining valid registrations', () => {
    const store = new ExtensionPointStore<ResourceEditorContribution>({ id: RESOURCE_EDITOR_EXTENSION_POINT });
    const valid = registration('addon/widget', 'addon');
    store.register(valid);
    expect(() => store.register(valid)).toThrow();
    expect(() => store.register({ ...valid, id: 'bad', value: { ...editor, ownedPaths: [['__proto__']] } })).toThrow();
    expect(() => store.register({ ...valid, id: 'duplicate-target', value: { ...editor, targets: [...editor.targets, ...editor.targets] } })).toThrow();
    expect(store.listAll()).toEqual([valid]);
    store.removeContributionsByPlugin('addon');
    expect(store.listAll()).toEqual([]);
  });
  it('admits lazy components and request-only targets but never nameless CRUD', () => {
    expect(validateResourceEditorContribution({ ...editor, component: { $$typeof: Symbol.for('react.lazy') } })).toBeNull();
    const requestOnly = { ...editor, targets: [{ ...editor.targets[0], resource: '' }], intents: ['action'], request: { protocol: 'kubernetes.review.v1', buildInput: () => ({}) } };
    expect(validateResourceEditorContribution(requestOnly)).toBeNull();
    expect(validateResourceEditorContribution({ ...requestOnly, intents: ['create'] })).not.toBeNull();
  });
});

describe('local protocol inspection', () => {
  it('admits captured envelopes without invented transport but forbids owned mutations', () => {
    const captured = { ...editor, targets: [{ ...editor.targets[0], resource: '' }], intents: ['inspect'], ownedPaths: [] };
    expect(validateResourceEditorContribution(captured)).toBeNull();
    expect(validateResourceEditorContribution({ ...captured, ownedPaths: [['spec']] })).not.toBeNull();
    expect(validateResourceEditorContribution({ ...captured, intents: ['edit'] })).not.toBeNull();
  });
});

describe('canonical request admission', () => {
  it.each([
    'kubernetes.review.v1',
    'kubernetes.service-account-token.v1',
    'kubernetes.csr-approval.v1',
    'kubernetes.pod-eviction.v1',
    'kubernetes.scale.v1',
  ])('admits host-only canonical extraction for %s without a provider callback', protocol => {
    expect(validateResourceEditorContribution({ ...editor, request: { protocol, source: 'canonical' } })).toBeNull();
    expect(validateResourceEditorContribution({ ...editor, request: { protocol, source: 'canonical', buildInput: () => ({}) } })).not.toBeNull();
  });
  it('rejects arbitrary canonical protocols and ambiguous projection requests', () => {
    expect(validateResourceEditorContribution({ ...editor, request: { protocol: 'vendor.raw.v1', source: 'canonical' } })).not.toBeNull();
    expect(validateResourceEditorContribution({ ...editor, request: { protocol: 'kubernetes.metrics.v1', source: 'canonical' } })).not.toBeNull();
    expect(validateResourceEditorContribution({ ...editor, request: { protocol: 'kubernetes.metrics.v1', source: 'projection' } })).not.toBeNull();
    expect(validateResourceEditorContribution({ ...editor, request: { protocol: 'kubernetes.metrics.v1', source: 'projection', buildInput: () => ({}) } })).toBeNull();
    expect(validateResourceEditorContribution({ ...editor, request: { protocol: 'kubernetes.metrics.v1', source: 'raw', buildInput: () => ({}) } })).not.toBeNull();
  });
});

describe('resource editor ownership policy admission', () => {
  it.each(['declarative', 'conditional', 'controller', 'system'])('admits explicit %s policy without changing denied capability facts', ownershipPolicy => {
    const contribution = { ...editor, ownershipPolicy } as ResourceEditorContribution;
    expect(validateResourceEditorContribution(contribution)).toBeNull();
    expect(matchesResourceEditor({ ...contribution, requirements: { capabilities: ['update'] } }, {
      ...context, capabilities: { ...context.capabilities, update: 'denied' },
    })).toBe(false);
  });
  it('preserves unknown default and rejects manifest-style self-grant policy values', () => {
    expect(validateResourceEditorContribution(editor)).toBeNull();
    expect(validateResourceEditorContribution({ ...editor, ownershipPolicy: 'application' })).not.toBeNull();
    expect(validateResourceEditorContribution({ ...editor, ownershipPolicy: { status: 'declarative' } })).not.toBeNull();
  });
});

describe('host-validated local capture matching', () => {
  it.each(['unknown', 'absent'] as const)('allows local inspection while preserving %s server discovery', status => {
    const local: ResourceEditorContext = {
      ...context, intent: 'inspect',
      discovery: { status, features: { 'host.local-capture': 'available' } },
    };
    expect(matchesResourceEditor(editor, local)).toBe(true);
    expect(local.discovery.status).toBe(status);
    expect(matchesResourceEditor(editor, { ...local, intent: 'create' })).toBe(false);
    expect(matchesResourceEditor(editor, { ...local, intent: 'edit' })).toBe(false);
    expect(matchesResourceEditor({ ...editor, intents: ['action'] }, { ...local, intent: 'action' })).toBe(false);
    expect(matchesResourceEditor(editor, { ...local, version: 'v2' })).toBe(false);
    expect(matchesResourceEditor({ ...editor, requirements: { capabilities: ['delete'] } }, local)).toBe(false);
  });
  it('does not bypass explicit denial or unavailable discovery', () => {
    for (const status of ['denied', 'unavailable'] as const) {
      expect(matchesResourceEditor(editor, {
        ...context, intent: 'inspect',
        discovery: { status, features: { 'host.local-capture': 'available' } },
      })).toBe(false);
    }
  });
});

describe('submission validator admission and passive inspection', () => {
  it('admits callable submission validation but rejects malformed callbacks', () => {
    expect(validateResourceEditorContribution({ ...editor, validateSubmission: async () => [] })).toBeNull();
    expect(validateResourceEditorContribution({ ...editor, validateSubmission: true })).not.toBeNull();
  });
  it('never invokes validators during registration, enumeration, matching or selection', () => {
    const validate = vi.fn(() => []);
    const validateSubmission = vi.fn(async () => []);
    const contribution = { ...editor, validate, validateSubmission };
    const store = new ExtensionPointStore<ResourceEditorContribution, ResourceEditorContext>({
      id: RESOURCE_EDITOR_EXTENSION_POINT,
      matcher: (entry, target) => target !== undefined && matchesResourceEditor(entry.value, target),
    });
    store.register({ ...registration('addon/widget', 'addon'), value: contribution });
    const inspected = { ...context, intent: 'inspect' } as const;
    expect(store.listAll()).toHaveLength(1);
    expect(store.list(inspected)).toHaveLength(1);
    expect(store.provide(inspected)).toEqual([contribution]);
    expect(matchesResourceEditor(contribution, inspected)).toBe(true);
    expect(selectResourceEditor(store.list(inspected), inspected, { builtinPluginID: 'kubernetes' }).status).toBe('selected');
    expect(validate).not.toHaveBeenCalled();
    expect(validateSubmission).not.toHaveBeenCalled();
  });
});
