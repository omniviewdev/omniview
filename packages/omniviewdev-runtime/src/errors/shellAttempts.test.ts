import { parseAppError } from './parseAppError';

describe('parseAppError: the shells a terminal tried', () => {
  const problem = (tried: unknown) =>
    JSON.stringify({
      type: 'omniview:terminal/shell-unavailable',
      title: 'Shell not found',
      status: 422,
      detail: 'shell executable unavailable: tried the shell asked for "/x/zsh": not found',
      code: 'SHELL_UNAVAILABLE',
      tried,
    });

  it('keeps the shells that were tried, in order, one entry for each', () => {
    const result = parseAppError(
      problem([
        { source: 'the shell asked for', path: '/x/zsh', reason: 'not found' },
        { source: '$SHELL', path: '/y/fish', reason: 'not executable' },
      ]),
    );
    expect(result.code).toBe('SHELL_UNAVAILABLE');
    expect(result.tried).toEqual([
      { source: 'the shell asked for', path: '/x/zsh', reason: 'not found' },
      { source: '$SHELL', path: '/y/fish', reason: 'not executable' },
    ]);
  });

  it('drops an entry that is not a source, a path and a reason, and keeps the rest', () => {
    const result = parseAppError(
      problem([
        { source: 'the shell asked for', path: '/x/zsh', reason: 'not found' },
        { source: 'the fallback', path: '/bin/sh' },
        'nonsense',
        { source: '', path: '/bin/bash', reason: 'not found' },
      ]),
    );
    expect(result.tried).toEqual([{ source: 'the shell asked for', path: '/x/zsh', reason: 'not found' }]);
  });

  it('has no list when the host sent none', () => {
    expect(parseAppError(problem(undefined)).tried).toBeUndefined();
    expect(parseAppError(problem('not a list')).tried).toBeUndefined();
  });
});
