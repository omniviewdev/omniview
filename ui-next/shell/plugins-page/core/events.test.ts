import { describe, expect, it } from 'vitest';
import { PHASES, readEnablement, readStateChange } from './events';

// What the page reads of the event that moves one plugin between phases (`backend/pkg/plugin/events.go`, `plugin/state_change`): the plugin's id and the phase it entered, and nothing else. The `reason` of a state
// change is the host's own text and holds the error of a failure, so it is never read here; a payload that is not an id and a phase this version of the host has is not an event.

describe('readStateChange', () => {
  it.each(PHASES)('reads the plugin and the phase %s it entered', (phase) => {
    expect(readStateChange({ pluginID: 'alpha', from: 'Starting', to: phase, reason: 'x', timestamp: '2026-11-22T10:00:00Z' })).toEqual({ id: 'alpha', phase });
  });

  it('reads the id and the phase and nothing else: the reason, which holds text of the plugin, goes no further', () => {
    const read = readStateChange({ pluginID: 'alpha', from: 'Running', to: 'Failed', reason: 'panic at /Users/me/.omniview/plugins/alpha: token=abc' });

    expect(read).toEqual({ id: 'alpha', phase: 'Failed' });
    expect(JSON.stringify(read)).not.toMatch(/Users|token|panic/);
  });

  it.each([
    ['no payload', undefined],
    ['a string', 'Running'],
    ['no id', { to: 'Running' }],
    ['an empty id', { pluginID: '', to: 'Running' }],
    ['a number for an id', { pluginID: 7, to: 'Running' }],
    ['no phase', { pluginID: 'alpha' }],
    ['a phase this host does not have', { pluginID: 'alpha', to: 'Levitating' }],
    ['a phase in the wrong case', { pluginID: 'alpha', to: 'running' }],
  ])('is not an event: %s', (_name, data) => {
    expect(readStateChange(data)).toBeUndefined();
  });
});

describe('readEnablement', () => {
  it('reads the plugin and whether it is on, and nothing else of the payload', () => {
    expect(readEnablement({ pluginID: 'alpha', enabled: false, detail: 'text of its own' })).toEqual({ id: 'alpha', enabled: false });
    expect(readEnablement({ pluginID: 'alpha', enabled: true })).toEqual({ id: 'alpha', enabled: true });
  });

  it.each([
    ['no payload', undefined],
    ['a string', 'alpha'],
    ['no id', { enabled: true }],
    ['an empty id', { pluginID: '', enabled: true }],
    ['no flag', { pluginID: 'alpha' }],
    ['a flag that is not a flag', { pluginID: 'alpha', enabled: 'yes' }],
  ])('is not an enablement: %s', (_name, data) => {
    expect(readEnablement(data)).toBeUndefined();
  });
});
