import { describe, expect, it } from 'vitest';
import { BundleTimeoutError, ContractError, IncompatibleBundleError, UNLOAD_CAUSES, classify, failureWords, unloadedFailure } from './failure';

// Each thing that can go wrong between the host and a plugin's bundle is one of five kinds, and the page says the same sentence for a kind whatever
// the words of the loader's own error were. SystemJS's messages are quoted as it writes them (systemjs 6.15: errors 3, 7 and 8).

describe('classify', () => {
  it('a bundle the host refused before it ran is incompatible, and the log names what it needed', () => {
    const failure = classify(new IncompatibleBundleError(['@omniviewdev/base-ui', 'react-router']));

    expect(failure.kind).toBe('incompatible');
    expect(failure.message).toBe('This plugin was built for another version of the app. Update it.');
    expect(failure.detail).toContain('@omniviewdev/base-ui, react-router');
  });

  it('a name SystemJS cannot resolve is incompatible too', () => {
    const failure = classify(new Error('(SystemJS Error#8 https://github.com/systemjs/systemjs/blob/main/docs/errors.md#8) Unable to resolve bare specifier \'@omniviewdev/editors\' from http://localhost/_/plugins/x/assets/entry.js'));

    expect(failure.kind).toBe('incompatible');
    expect(failure.detail).toBe('It imports @omniviewdev/editors, which this version does not serve');
  });

  it('a file the host could not serve is missing', () => {
    const status = classify(new Error('(SystemJS Error#7 https://github.com/systemjs/systemjs/blob/main/docs/errors.md#7) 400 Bad Request, loading http://localhost/_/plugins/x/assets/entry.js'));
    const script = classify(new Error('(SystemJS Error#3 https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3) Error loading http://localhost/_/plugins/x/assets/entry.js'));
    const network = classify(new TypeError('Failed to fetch'));

    expect([status.kind, script.kind, network.kind]).toEqual(['missing', 'missing', 'missing']);
  });

  it('a bundle that threw when it ran is broken, and only the first line of its text reaches the log', () => {
    const failure = classify(new Error('boom\n    at entry.js:1:1\n    at somewhere'));

    expect(failure).toEqual({ kind: 'broken', message: 'The plugin\'s interface failed to start.', detail: 'boom' });
  });

  it('a value that is not an error is broken, with its text', () => {
    expect(classify('plain string')).toMatchObject({ kind: 'broken', detail: 'plain string' });
  });

  it('a late bundle is a timeout', () => {
    expect(classify(new BundleTimeoutError(30_000))).toMatchObject({ kind: 'timeout', detail: 'The bundle did not finish loading in 30000 ms' });
  });

  it('a contribution the host does not understand is a contract failure carrying its problems', () => {
    expect(classify(new ContractError(['home "x" is not one of the pages', 'sidebar needs a label and a title']))).toMatchObject({
      kind: 'contract',
      detail: 'home "x" is not one of the pages; sidebar needs a label and a title',
    });
  });

  it('never puts the plugin\'s own words in the sentence a person reads', () => {
    const failure = classify(new Error('SECRET token=abc123 leaked in a stack'));

    expect(failure.message).not.toContain('abc123');
    expect(failure.message).toBe('The plugin\'s interface failed to start.');
  });
});

// A plugin that was loaded and then stopped (PU1), or whose load failed (PU2), has no bundle that failed: the host said it stopped or could not start, in one of six words, and the page words each itself.

describe('unloadedFailure', () => {
  it('says a crashed plugin stopped unexpectedly, in the words of the mock\'s failed plugin (ch16 S89)', () => {
    expect(unloadedFailure('crashed')).toEqual({ kind: 'unloaded', cause: 'crashed', message: 'The plugin process stopped unexpectedly, so its pages can\'t load data.' });
  });

  it('says a plugin that is reloading is starting again, in the words of the mock\'s starting plugin', () => {
    expect(unloadedFailure('reloaded')).toEqual({ kind: 'unloaded', cause: 'reloaded', message: 'The plugin is starting again. The page opens when it is ready.' });
  });

  it('says a plugin whose load failed could not start, and one that ran out of time took too long (PU2)', () => {
    expect(unloadedFailure('failed')).toEqual({ kind: 'unloaded', cause: 'failed', message: 'The plugin could not start, so its pages can\'t load data.' });
    expect(unloadedFailure('timeout')).toEqual({ kind: 'unloaded', cause: 'timeout', message: 'The plugin took too long to start, so its pages can\'t load data.' });
  });

  it('has no detail and no text of the plugin: nothing but the host\'s sentence', () => {
    for (const cause of ['crashed', 'reloaded', 'failed', 'timeout'] as const) {
      expect(Object.keys(unloadedFailure(cause)).sort()).toEqual(['cause', 'kind', 'message']);
    }
  });
});

describe('the six causes', () => {
  it('are the host\'s six words: what the event of backend/pkg/plugin/events.go can carry', () => {
    expect([...UNLOAD_CAUSES]).toEqual(['crashed', 'reloaded', 'uninstalled', 'disabled', 'failed', 'timeout']);
  });
});

describe('failureWords', () => {
  it('says "did not load" of a bundle that failed, whatever the kind, and calls it a fault', () => {
    for (const kind of ['missing', 'incompatible', 'broken', 'timeout', 'contract'] as const) {
      expect(failureWords({ kind, message: 'x' })).toEqual({ label: 'did not load', caption: 'Did not load', faulted: true });
    }
  });

  it('says a plugin whose process crashed is stopped, and a fault', () => {
    expect(failureWords(unloadedFailure('crashed'))).toEqual({ label: 'stopped', caption: 'Stopped', faulted: true });
  });

  it('says a plugin that is reloading is starting again, and no fault: nothing failed', () => {
    expect(failureWords(unloadedFailure('reloaded'))).toEqual({ label: 'starting again', caption: 'Starting again', faulted: false });
  });

  it('says a plugin whose load failed did not start, and one that ran out of time timed out: both are faults', () => {
    expect(failureWords(unloadedFailure('failed'))).toEqual({ label: 'did not start', caption: 'Did not start', faulted: true });
    expect(failureWords(unloadedFailure('timeout'))).toEqual({ label: 'timed out', caption: 'Timed out', faulted: true });
  });
});
