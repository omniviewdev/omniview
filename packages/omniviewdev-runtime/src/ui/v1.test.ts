import { describe, expect, expectTypeOf, it } from 'vitest';
import * as main from '../index';
import * as curated from './v1';

// `@omniviewdev/runtime/ui/v1` is the one module of this package a new-UI plugin imports. These are its run-time names, written out: a name added here
// is a reviewed change to the contract (and to `api/ui-v1.api.md`), not a side effect of a re-export. The types are checked by the API report.
const VALUES = [
  'ErrorTypes',
  'extensionRootOf',
  'isCancelledError',
  'jsonToValue',
  'openLogStream',
  'parseAppError',
  'useConnectionMetadata',
  'useConnectionReadiness',
  'useConnections',
  'useResolvedResourceTarget',
  'useResourceTypes',
  'useResources',
  'valueToJSON',
] as const;

// The opaque root and log stream belong only to this entry. Its useConnectionMetadata wraps the main entry's positional function.
const ONLY_HERE: readonly string[] = ['extensionRootOf', 'openLogStream', 'useConnectionMetadata'];

describe('@omniviewdev/runtime/ui/v1', () => {
  it('exposes exactly the curated owner values', () => {
    expect(Object.keys(curated).sort()).toEqual([...VALUES]);
    expect('extensionRootOf' in main).toBe(false);
    expectTypeOf({}).not.toMatchTypeOf<curated.ExtensionRootV1>();
    expectTypeOf(curated.extensionRootOf).returns.toEqualTypeOf<curated.ExtensionRootV1 | undefined>();
  });

  it('serves the main entry\'s own functions, not copies: the host mounts the providers they read once', () => {
    for (const name of VALUES.filter((each) => !ONLY_HERE.includes(each))) {
      expect(curated[name], name).toBe(main[name as keyof typeof main]);
    }
  });

  it('keeps the previous UI library, the router and the activity surfaces out of it', () => {
    const names = new Set(Object.keys(curated));
    for (const name of ['ActivityProvider', 'ConnectionBoundary', 'usePluginRouter', 'Link', 'useResourceMutations', 'useResourceSearch',
      'extensionRootProof', 'subscribeExtensionRoot', 'CollectionRootSource']) {
      expect(names.has(name), name).toBe(false);
    }
  });
});
