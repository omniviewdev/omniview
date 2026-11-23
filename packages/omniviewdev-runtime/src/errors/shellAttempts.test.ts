import { parseAppError } from './parseAppError';

describe('parseAppError: the shells a terminal tried', () => {
  const problem = (tried: unknown, detail = 'shell executable unavailable: tried the shell asked for "/x/zsh": not found') =>
    JSON.stringify({
      type: 'omniview:terminal/shell-unavailable',
      title: 'Shell not found',
      status: 422,
      detail,
      code: 'SHELL_UNAVAILABLE',
      tried,
    });

  it('keeps the shells that were tried, in order, as the tokens the host sent', () => {
    const result = parseAppError(
      problem([
        { source: 'requested', path: '/x/zsh', reason: 'not-found' },
        { source: 'environment', path: '/y/fish', reason: 'not-executable' },
        { source: 'account', path: '/z/nu', reason: 'not-a-shell' },
        { source: 'fallback', path: '/bin/sh', reason: 'other', detail: 'input/output error' },
      ]),
    );
    expect(result.code).toBe('SHELL_UNAVAILABLE');
    expect(result.tried).toEqual([
      { source: 'requested', path: '/x/zsh', reason: 'not-found' },
      { source: 'environment', path: '/y/fish', reason: 'not-executable' },
      { source: 'account', path: '/z/nu', reason: 'not-a-shell' },
      { source: 'fallback', path: '/bin/sh', reason: 'other', detail: 'input/output error' },
    ]);
  });

  it('reads a token it does not know as other, and keeps the path', () => {
    const result = parseAppError(
      problem([
        { source: 'registry', path: '/x/zsh', reason: 'not-found' },
        { source: 'requested', path: '/y/fish', reason: 'cursed' },
        { source: 'requested', path: '/z/nu' },
      ]),
    );
    expect(result.tried).toEqual([
      { source: 'other', path: '/x/zsh', reason: 'not-found' },
      { source: 'requested', path: '/y/fish', reason: 'other' },
      { source: 'requested', path: '/z/nu', reason: 'other' },
    ]);
  });

  it('drops an entry that has no path, and what is not an entry, and keeps the rest', () => {
    const result = parseAppError(
      problem([
        { source: 'requested', path: '/x/zsh', reason: 'not-found' },
        { source: 'fallback', reason: 'not-found' },
        'nonsense',
        { source: 'fallback', path: '', reason: 'not-found' },
      ]),
    );
    expect(result.tried).toEqual([{ source: 'requested', path: '/x/zsh', reason: 'not-found' }]);
  });

  it('keeps the shells and the code when the sentence is long: the list has every path', () => {
    const long = `/${'d'.repeat(1400)}`;
    const result = parseAppError(
      problem(
        [1, 2, 3].map((n) => ({ source: 'fallback', path: `${long}${String(n)}`, reason: 'not-found' })),
        `shell executable unavailable: tried ${'x'.repeat(2000)}…`,
      ),
    );
    expect(result.code).toBe('SHELL_UNAVAILABLE');
    expect(result.tried).toHaveLength(3);
  });

  it('has no list when the host sent none', () => {
    expect(parseAppError(problem(undefined)).tried).toBeUndefined();
    expect(parseAppError(problem('not a list')).tried).toBeUndefined();
  });
});
