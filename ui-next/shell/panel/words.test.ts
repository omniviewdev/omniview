import { describe, expect, it } from 'vitest';
import type { SessionItem } from '../core/panel';
import { bodyId, sessionName, sessionTabId, stateWord, toolTabId, toggleChordKeys, toggleChordText } from './words';

// The words and the DOM ids of the panel. An id of the DOM that two different ids share is two tabs and two bodies pointing at one another's `aria-controls` and `aria-labelledby`.

const PREFIX = ':r1:-panel';

const item = (extra: Partial<SessionItem> = {}): SessionItem => ({ id: 's1', tool: 'terminal', title: 'zsh', head: 'zsh', tail: '', scope: '', name: 'zsh', state: 'running', since: 1, ...extra });

describe('the DOM ids of the panel (CodeRabbit, words.ts:18)', () => {
  const MAKERS = { tool: toolTabId, session: sessionTabId, body: bodyId };

  it('are made of letters, digits, hyphens and underscores, whatever the id', () => {
    for (const make of Object.values(MAKERS)) {
      expect(make(PREFIX, 'a b/c:d\u03AB\u{1F600}\u0000"\'<>')).toMatch(/^[^\s]+$/);
      expect(make('p', 'a b/c:d\u03AB\u{1F600}\u0000"\'<>')).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('are not shared by two ids that once became the same: a code of variable width made `:b` and `\u03AB` both `_3ab`', () => {
    for (const make of Object.values(MAKERS)) {
      expect(make(PREFIX, ':b')).not.toBe(make(PREFIX, '\u03AB'));
    }
  });

  it('are not shared by an escape written out and the character it stands for', () => {
    for (const make of Object.values(MAKERS)) {
      expect(make('p', ':')).not.toBe(make('p', '_003a'));
      expect(make('p', '_')).not.toBe(make('p', '_005f'));
      expect(make('p', 'a_b')).not.toBe(make('p', 'a b'));
    }
  });

  it('are one to one over a large set of ids that look alike (ASCII punctuation, plain letters, escapes, astral characters)', () => {
    const alphabet = ['a', 'b', '-', '_', ':', ' ', '/', '.', '\u03AB', '\u00EB', '\u{1F600}', '0', 'f'];
    const ids = new Set<string>();
    const build = (prefix: string, depth: number): void => {
      ids.add(prefix);
      if (depth === 0) {
        return;
      }

      for (const character of alphabet) {
        build(prefix + character, depth - 1);
      }
    };

    build('', 4);
    const made = new Map<string, string>();
    for (const id of ids) {
      const dom = sessionTabId('p', id);
      const clash = made.get(dom);
      expect(clash, `${JSON.stringify(id)} and ${JSON.stringify(clash)} are both ${dom}`).toBeUndefined();
      made.set(dom, id);
    }

    expect(made.size).toBe(ids.size);
  });

  it('leave a generated id, and plain words, as they are, so the DOM of an ordinary session reads like its id', () => {
    const uuid = '3f2c1b9e-8a47-4c1d-9b0e-6d5f7a8b9c0d';
    expect(sessionTabId('p', uuid)).toBe(`p-session-${uuid}`);
    expect(toolTabId('p', 'terminal')).toBe('p-tool-terminal');
    expect(bodyId('p', 's1')).toBe('p-body-s1');
  });

  it('keep a tool, a session and a body of one id apart', () => {
    expect(new Set([toolTabId('p', 'x'), sessionTabId('p', 'x'), bodyId('p', 'x')]).size).toBe(3);
  });
});

describe('the words of a session tab', () => {
  it('names a session by its whole name, and adds its state when it is not steady', () => {
    expect(sessionName(item())).toBe('zsh');
    expect(sessionName(item({ state: 'starting', name: 'zsh (2) · dev' }))).toBe('zsh (2) · dev, starting');
    expect(sessionName(item({ state: 'ended' }))).toBe('zsh, ended');
    expect(sessionName(item({ state: 'failed' }))).toBe('zsh, failed');
    expect(stateWord('running')).toBe('');
  });

  it('writes the toggle chord as the platform does', () => {
    expect(toggleChordText('mac')).toBe('\u2318J');
    expect(toggleChordText('other')).toBe('Ctrl+J');
    expect(toggleChordKeys('mac')).toBe('Meta+J');
    expect(toggleChordKeys('other')).toBe('Control+J');
  });
});
