import { describe, expect, it, vi } from 'vitest';
import { pickerOf, type PickerInput } from './picker';
import type { HostConnection } from './types';

// The picker of the connection face (HM1): the plugin's own connections, by name, with the state each is in, and the one the face says marked as current.

const connection = (plugin: string, key: string, name: string, state: HostConnection['state'] = 'connected', reason?: string): HostConnection => ({ plugin, key, name, state, reason });

const input = (over: Partial<PickerInput> = {}): PickerInput => ({
  plugin: 'acme',
  connections: [connection('acme', 'k1', 'north'), connection('acme', 'k2', 'south', 'unauthorized', 'The connection needs you to sign in.'), connection('other', 'k3', 'elsewhere')],
  named: undefined,
  text: undefined,
  icon: 'server',
  onOpen: () => undefined,
  onChoose: () => undefined,
  ...over,
});

describe('the picker of the connection face', () => {
  it('lists the connections of the plugin on screen by name, with their states, and none of another plugin\'s', () => {
    const picker = pickerOf(input());

    expect(picker?.options.map((option) => [option.id, option.label, option.state.word, option.reason, option.busy])).toEqual([
      ['k1', 'north', 'Connected', undefined, false],
      ['k2', 'south', 'Needs sign-in', 'The connection needs you to sign in.', false],
    ]);
    expect(picker?.options.map((option) => option.state.role)).toEqual(['healthy', 'attention']);
  });

  it('says a connection that is being started as busy, in the word of that state', () => {
    const picker = pickerOf(input({ connections: [connection('acme', 'k1', 'north', 'connecting')] }));

    expect(picker?.options[0]).toMatchObject({ busy: true, state: { role: 'progress', word: 'Connecting…' } });
  });

  it('is none when the plugin has no connection the window knows: the face stays text', () => {
    expect(pickerOf(input({ plugin: 'nobody' }))).toBeUndefined();
  });

  it('marks the connection the route names as the current one', () => {
    expect(pickerOf(input({ named: 'k2' }))?.current).toBe('k2');
  });

  it('marks the one connection the face\'s text names when the route names none, and none when two share the name or the route\'s key is unknown', () => {
    expect(pickerOf(input({ text: 'north' }))?.current).toBe('k1');
    expect(pickerOf(input({ text: 'nobody' }))?.current).toBeUndefined();
    expect(pickerOf(input({ named: 'gone' }))?.current).toBeUndefined();
    const twins = [connection('acme', 'k1', 'prod'), connection('acme', 'k2', 'prod')];
    expect(pickerOf(input({ connections: twins, text: 'prod' }))?.current).toBeUndefined();
  });

  it('prefers the route\'s key to the face\'s text', () => {
    expect(pickerOf(input({ named: 'k2', text: 'north' }))?.current).toBe('k2');
  });

  it('hands what was chosen and the opening to the window by key', () => {
    const onChoose = vi.fn();
    const onOpen = vi.fn();
    const picker = pickerOf(input({ onChoose, onOpen }));

    picker?.onOpen?.();
    picker?.onChoose('k2');

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith('k2');
  });
});
