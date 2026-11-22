import { describe, expect, it } from 'vitest';
import { classify, unloadedFailure, type GoneCause } from '../../../plugins/loader/failure';
import type { PluginEntry } from '../../../plugins/host/pluginStore';
import { acme } from '../../../plugins/testing';
import { stateOf } from './state';
import type { Installed } from './types';

// The one state of a plugin, as the page says it: from the phase the host holds it in, whether the person turned it off, and what the window's plugin store says of its interface (the same entries the rail reads, so
// the page and the rail cannot say two things of one plugin). Every word and sentence here is the host's own: nothing of the plugin's own text, and nothing the page would have to guess.

const plugin = (patch: Partial<Installed> = {}): Installed => ({
  id: 'alpha',
  name: 'Alpha Metrics',
  version: '1.8.2',
  description: 'Dashboards and data sources for the alpha service.',
  publisher: 'Fixture Labs',
  license: 'Apache-2.0',
  category: 'Monitoring',
  repository: '',
  website: '',
  tags: [],
  dependencies: [],
  capabilities: ['resource'],
  builtin: false,
  enabled: true,
  devMode: false,
  releaseChannel: '',
  phase: 'Running',
  ...patch,
});

const ready: PluginEntry = { id: 'alpha', name: 'Alpha Metrics', phase: 'ready', contribution: acme() };
const loading: PluginEntry = { id: 'alpha', name: 'Alpha Metrics', phase: 'loading' };
const gone = (cause: GoneCause): PluginEntry => ({ id: 'alpha', name: 'Alpha Metrics', phase: 'failed', failure: unloadedFailure(cause) });
const broken: PluginEntry = { id: 'alpha', name: 'Alpha Metrics', phase: 'failed', failure: classify(new Error('boom')) };

describe('a plugin the host holds', () => {
  it('running has no word to say: a healthy plugin has no state', () => {
    expect(stateOf({ installed: plugin(), entry: undefined, removing: false })).toMatchObject({ kind: 'running', word: '', tone: 'success', busy: false, faulted: false, title: 'Alpha Metrics is running' });
  });

  it.each([
    ['with its interface ready', ready],
    ['with its interface still loading, which is the window\'s business and no state of the plugin', loading],
  ])('running is running %s', (_name, entry) => {
    expect(stateOf({ installed: plugin(), entry, removing: false })).toMatchObject({ kind: 'running', word: '' });
  });

  it.each(['Starting', 'Validating', 'Installing', 'Building'])('in the phase %s is starting, which is work and no fault', (phase) => {
    expect(stateOf({ installed: plugin({ phase }), entry: undefined, removing: false })).toMatchObject({ kind: 'starting', word: 'Starting', tone: 'neutral', busy: true, faulted: false });
  });

  it('recovering from a crash says so: the host is starting it again', () => {
    expect(stateOf({ installed: plugin({ phase: 'Recovering' }), entry: undefined, removing: false })).toMatchObject({ kind: 'starting', word: 'Recovering', busy: true, faulted: false });
  });

  it('degraded says it is running with errors', () => {
    expect(stateOf({ installed: plugin({ phase: 'Degraded' }), entry: undefined, removing: false })).toMatchObject({ kind: 'degraded', word: 'Degraded', tone: 'warning', busy: false, title: 'Alpha Metrics is running with errors' });
  });

  it('stopping is work', () => {
    expect(stateOf({ installed: plugin({ phase: 'Stopping' }), entry: undefined, removing: false })).toMatchObject({ kind: 'stopping', word: 'Stopping', busy: true });
  });

  it.each(['Stopped', 'Installed'])('stopped in the phase %s, enabled, is stopped: it is not running and it was not turned off', (phase) => {
    expect(stateOf({ installed: plugin({ phase }), entry: undefined, removing: false })).toMatchObject({ kind: 'stopped', word: 'Stopped', tone: 'neutral', busy: false, faulted: false, title: 'Alpha Metrics is stopped' });
  });

  it('turned off is disabled, whatever phase the host holds it in', () => {
    for (const phase of ['Installed', 'Stopped', 'Stopping', 'Running']) {
      expect(stateOf({ installed: plugin({ enabled: false, phase }), entry: undefined, removing: false })).toMatchObject({ kind: 'disabled', word: 'Disabled', tone: 'neutral', busy: false, faulted: false, title: 'Alpha Metrics is disabled' });
    }
  });

  it('whose start failed says it did not start, in the host\'s sentence', () => {
    expect(stateOf({ installed: plugin({ phase: 'Failed' }), entry: undefined, removing: false })).toMatchObject({
      kind: 'failed',
      word: 'Did not start',
      tone: 'error',
      cause: 'failed',
      faulted: true,
      sentence: unloadedFailure('failed').message,
    });
  });

  it('whose development build failed says the build failed', () => {
    expect(stateOf({ installed: plugin({ phase: 'BuildFailed', devMode: true }), entry: undefined, removing: false })).toMatchObject({
      kind: 'failed',
      word: 'Build failed',
      cause: 'build',
      faulted: true,
      sentence: 'The development build failed, so the plugin can\'t start.',
    });
  });

  it('being uninstalled is removing', () => {
    expect(stateOf({ installed: plugin({ phase: 'Uninstalling' }), entry: undefined, removing: false })).toMatchObject({ kind: 'removing', word: 'Removing', busy: true });
  });

  it('in a phase this version does not know says it does not know, and claims nothing', () => {
    expect(stateOf({ installed: plugin({ phase: 'Levitating' }), entry: undefined, removing: false })).toMatchObject({ kind: 'unknown', word: 'Unknown', tone: 'neutral', busy: false, faulted: false });
  });
});

describe('what the window says of the plugin\'s interface is the rail\'s word', () => {
  it.each<[GoneCause, string, boolean, string]>([
    ['crashed', 'Stopped', true, 'failed'],
    ['reloaded', 'Starting again', false, 'starting'],
    ['failed', 'Did not start', true, 'failed'],
    ['timeout', 'Timed out', true, 'failed'],
  ])('a plugin that is gone because it %s says %s (a fault: %s)', (cause, word, faulted, kind) => {
    expect(stateOf({ installed: plugin(), entry: gone(cause), removing: false })).toMatchObject({ kind, word, faulted, cause, sentence: unloadedFailure(cause).message, busy: cause === 'reloaded' });
  });

  it('whose interface did not load says it did not load, with the sentence the window gave it', () => {
    expect(stateOf({ installed: plugin(), entry: broken, removing: false })).toMatchObject({ kind: 'failed', word: 'Did not load', tone: 'error', cause: 'interface', faulted: true, sentence: classify(new Error('boom')).message });
  });

  it('is never the text of an error: a plugin\'s own words are nowhere in a state', () => {
    const text = JSON.stringify(stateOf({ installed: plugin({ phase: 'Failed' }), entry: broken, removing: false }));
    expect(text).not.toMatch(/boom/);
  });

  it('is only what the plugin is when it is turned off: a stale failure of the interface does not outrank the person\'s choice', () => {
    expect(stateOf({ installed: plugin({ enabled: false }), entry: gone('crashed'), removing: false })).toMatchObject({ kind: 'disabled', word: 'Disabled' });
  });

  it('is removing from the moment the host says it is being uninstalled, whatever else it says', () => {
    expect(stateOf({ installed: plugin(), entry: ready, removing: true })).toMatchObject({ kind: 'removing', word: 'Removing', busy: true });
    expect(stateOf({ installed: plugin({ enabled: false }), entry: undefined, removing: true })).toMatchObject({ kind: 'removing' });
  });
});
