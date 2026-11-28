// @vitest-environment node
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as sdk from './v1.js';

describe('@omniviewdev/runtime/ui/extensions/v1', () => {
  it('exports only literal author builders, the publication and the outlet presenters', () => {
    expect(Object.keys(sdk).sort()).toEqual([
      'defineMenuOffer', 'defineOffer', 'definePlugin', 'definePoint', 'defineProtocol', 'defineRead', 'defineViewOffer',
      'menuOutlet', 'outlet', 'tabOutlet', 'utilizationV1',
    ]);
    expect(sdk.utilizationV1).toEqual({
      id: 'visuals/utilization@1', published: true, kind: 'section',
      fields: { used: 'number', capacity: 'number' }, schema: { label: 'string', value: 'string' },
    });
    for (const value of [sdk.utilizationV1, sdk.utilizationV1.fields, sdk.utilizationV1.schema]) expect(Object.isFrozen(value)).toBe(true);
  });

  it('preserves read, protocol, point, offer and descriptor data without registering anything', () => {
    const read = sdk.defineRead('owner/edges@1', { row: { target: 'string' } });
    expect(read).toEqual({ id: 'owner/edges@1', row: { target: 'string' } });
    const protocol = sdk.defineProtocol('owner/inspector@1', { kind: 'view', fields: { count: 'number' }, optional: ['count'], read });
    expect(protocol).toEqual({ id: 'owner/inspector@1', published: false, kind: 'view', fields: { count: 'number' }, optional: ['count'], read });
    const point = sdk.definePoint('owner', 'inspectors', protocol, { label: 'Inspectors', placement: 'detail-tab' });
    expect(point).toEqual({ owner: 'owner', id: 'inspectors', protocol, label: 'Inspectors', placement: 'detail-tab' });
    const options = { label: 'Edges', requests: ['count'], targets: [{ point, when: [{ field: 'count', equals: 0 }] }], requestRead: true } as const;
    const edges = sdk.defineViewOffer(protocol, options);
    expect(edges).toEqual({ protocol, ...options });
    expect(edges.targets).toBe(options.targets);
    const descriptor = { id: 'peer', offers: { edges } } as const;
    expect(sdk.definePlugin(descriptor)).toBe(descriptor);
  });

  it('returns only the local point ID and the supplied owner context; does not walk or load data', () => {
    const context = Object.defineProperty({ kind: 'Resource' }, 'count', { get: () => { throw new Error('unexpected projection'); } });
    const fields = { kind: 'string', count: 'number' } as const;
    const tabs = sdk.definePoint('owner', 'tabs', sdk.defineProtocol('owner/tab@1', { kind: 'view', fields, optional: ['count'] }), {
      label: 'Tabs', placement: 'detail-tab',
    });
    const actions = sdk.definePoint('owner', 'actions', sdk.defineProtocol('owner/menu@1', { kind: 'menu', fields, optional: ['count'] }), {
      label: 'Actions', placement: 'context-menu',
    });
    const section = sdk.definePoint('owner', 'usage', sdk.utilizationV1, { label: 'Usage', placement: 'overview-section', warmOnPage: 'overview' });
    const usage = { used: 0, capacity: 1 };
    expect(sdk.outlet(section, usage)).toEqual({ point: 'usage', context: usage });
    for (const [placed, id] of [[sdk.tabOutlet(tabs, context), 'tabs'], [sdk.menuOutlet(actions, context), 'actions']] as const) {
      expect(Object.keys(placed).sort()).toEqual(['context', 'point']);
      expect(placed.point).toBe(id);
      expect(placed.context).toBe(context);
    }
  });

  it('checks author projections and negative declarations with strict optional properties and no ambient UI or Node types', () => {
    const fixture = path.resolve(import.meta.dirname, '../../../scripts/fixtures/extensions-v1-author.ts');
    const program = ts.createProgram([fixture], {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [], lib: ['lib.es2020.d.ts'],
    });
    const diagnostics = ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (name) => name, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n',
    });
    expect(diagnostics).toBe('');
  });
});
