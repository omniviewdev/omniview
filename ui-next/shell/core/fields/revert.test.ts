import { describe, expect, it } from 'vitest';
import { makeForm, schemaOf } from './testing';
import type { CommitResult, RemoteValidator } from './types';

// The host's check is the gate of a commit, whatever happened to the field before: a value the host refused is not sent, also when the field was reverted (Escape, a page change) and typed into again. The settings
// sheet found it: after a revert the next Enter sent the value although `Validate` had refused it, and only the host's own `Commit` stood in the way.

const PORT = { id: 'port', kind: 'number', label: 'Port', default: 6060, integer: true, min: 0, max: 65535, validate: { remote: 'host' } };

const refusing = (asked: unknown[]): Readonly<Record<string, RemoteValidator>> => ({
  host: async ({ value }) => {
    asked.push(value);
    return { valid: false, message: 'Not that.' };
  },
});

describe('a refused value', () => {
  it('is not sent: typed as text a key at a time, committed, reverted, typed again and committed, the form sends nothing', async () => {
    const asked: unknown[] = [];
    const { store, clock, submits } = makeForm(schemaOf(PORT), { mode: 'apply-on-change', validators: refusing(asked) });
    const type = (text: string): void => {
      for (let length = 1; length <= text.length; length += 1) {
        store.setValue('port', text.slice(0, length));
      }
    };

    const enter = async (): Promise<CommitResult> => {
      const result = store.commit('port');
      await clock.flush();
      return result;
    };

    type('7000');
    expect((await enter()).status).toBe('invalid');
    store.revert('port');
    type('7001');
    expect((await enter()).status).toBe('invalid');
    expect(asked).toEqual([7000, 7001]);
    expect(submits).toEqual([]);
  });
});
