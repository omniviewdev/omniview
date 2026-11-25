import { describe, expect, it } from 'vitest';
import * as main from '../index';
import * as curated from './v1';

// `@omniviewdev/runtime/ui/v1` is the one module of this package a new-UI plugin imports. These are its run-time names, written out: a name added here
// is a reviewed change to the contract (and to `api/ui-v1.api.md`), not a side effect of a re-export. The types are checked by the API report.
const VALUES = [
  'ErrorTypes',
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

// Names this entry does not serve as the main entry's own function: the log stream is a contract of the new shell, not a hook the old shell's providers serve;
// `useConnectionMetadata` is a wrapper in the options form over the main entry's positional hook, which is a shipped API and stays (`ui/useConnectionMetadata.ts`;
// its test holds that both share one cache).
const ONLY_HERE: readonly string[] = ['openLogStream', 'useConnectionMetadata'];

describe('@omniviewdev/runtime/ui/v1', () => {
  it('exposes exactly the data layer the first plugin reads through, and the log stream', () => {
    expect(Object.keys(curated).sort()).toEqual([...VALUES]);
  });

  it('serves the main entry\'s own functions, not copies: the host mounts the providers they read once', () => {
    for (const name of VALUES.filter((each) => !ONLY_HERE.includes(each))) {
      expect(curated[name], name).toBe(main[name as keyof typeof main]);
    }
  });

  it('keeps the previous UI library, the router and the activity surfaces out of it', () => {
    const names = new Set(Object.keys(curated));
    for (const name of ['ActivityProvider', 'ConnectionBoundary', 'usePluginRouter', 'Link', 'useResourceMutations', 'useResourceSearch']) {
      expect(names.has(name), name).toBe(false);
    }
  });
});
