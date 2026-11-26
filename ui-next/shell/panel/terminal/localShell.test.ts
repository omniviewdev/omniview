import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST } from '../../core/panel';
import type { TerminalChannels } from './channel';
import { createExecFeed } from './execFeed';
import type { TerminalFeedHandle } from './feed';
import { attachLocalTerminal, localHereTarget, localProfileTarget, localRestartTarget, localShellTarget, restoreLocalTerminals } from './localShell';
import { appTerminalChannels } from './terminalChannel';

// The host's own shell as a feed, on the terminal channel: `localShell.ts` only maps the targets of the Terminal tool onto `TerminalChannels` (`channel.ts`): which feed a target opens, under which id, with which lease, and
// which terminals a page that reloaded finds again. The rules of the session are the feed's (`execFeed.ts`), which is replaced here by a recorder of the options it was made with.

vi.mock('./execFeed', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), createExecFeed: vi.fn() }));
vi.mock('./terminalChannel', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), appTerminalChannels: vi.fn() }));

type Options = Parameters<typeof createExecFeed>[0];

/** The channels of a page, as far as these targets touch them: only `list` is called by making a target. */
function channels(listed: readonly unknown[] = []): TerminalChannels & { readonly list: ReturnType<typeof vi.fn> } {
  const refuse = vi.fn(async () => Promise.reject(new Error('not expected')));
  return {
    create: refuse,
    connect: vi.fn(() => {
      throw new Error('not expected');
    }),
    close: refuse,
    dismiss: refuse,
    busy: refuse,
    cwd: refuse,
    list: vi.fn(async () => Promise.resolve(listed)),
    listed: refuse,
    describe: () => '',
    isGone: () => false,
    codeOf: () => undefined,
    triedOf: () => undefined,
  };
}

const feed = { name: 'a feed' } as unknown as TerminalFeedHandle;

/** What the last feed was made with. */
const made = (): Options => {
  const last = vi.mocked(createExecFeed).mock.calls.at(-1)?.[0];
  expect(last, 'a feed was made').toBeDefined();
  return last!;
};

beforeEach(() => {
  vi.mocked(createExecFeed).mockReset();
  vi.mocked(createExecFeed).mockReturnValue(feed as never);
  vi.mocked(appTerminalChannels).mockReset();
});

describe('the target of a terminal started from a profile', () => {
  const profile = { name: 'zsh', path: '/usr/bin/zsh', args: ['-f'], env: { A: '1' }, cwd: '/work' };

  it('is called by the profile until the host says which shell it started, and asks the host for the profile\'s shell, directory and environment', () => {
    const target = localProfileTarget(profile, channels());
    expect(target.title).toBe('zsh');
    target.open();
    expect(made().launch).toEqual({ command: ['/usr/bin/zsh', '-f'], cwd: '/work', env: { A: '1' } });
  });

  it('starts under the id of its session, with the lease it was asked for, on the channels it was given, like the target of the `+`', () => {
    const given = channels();
    const target = localProfileTarget(profile, given, 90_000);
    expect(target).toMatchObject({ plugin: HOST, id: 'local' });
    expect(typeof target.sessionId).toBe('string');
    target.open();
    const options = made();
    expect(options.channels).toBe(given);
    expect(options.newId?.()).toBe(target.sessionId);
    expect(options.leaseMs).toBe(90_000);
  });

  it('is named by the shell the host says it started, as the target of the `+` is', () => {
    expect(localProfileTarget(profile, channels()).retitle?.({ program: 'zsh' } as never)).toBe('zsh');
  });

  it('asks for no shell when it is the target of the `+`, which has no profile: the host starts the default', () => {
    localShellTarget(channels()).open();
    expect(made()).not.toHaveProperty('launch');
  });
});

describe('the target of "New terminal here"', () => {
  it('asks the host for the directory the terminal it was opened from said it is in, and for nothing else: the shell is the host\'s default, with no arguments and no environment', () => {
    localHereTarget({ state: 'known', path: '/usr', source: 'shell' }, channels()).open();
    expect(made().launch).toEqual({ cwd: '/usr' });
    expect(made().startNote).toBeUndefined();
  });

  it('asks for the directory a terminal that ended started in, as it is: the producer\'s fact is passed on, whichever fact it is', () => {
    localHereTarget({ state: 'known', path: '/srv/app', source: 'start' }, channels()).open();
    expect(made().launch).toEqual({ cwd: '/srv/app' });
  });

  it('falls back to home, with the note, when the directory an ended terminal started in is gone: only a start directory can have been removed since', () => {
    localHereTarget({ state: 'known', path: '/srv/app', source: 'start' }, channels()).open();
    expect(made().homeIfMissing).toBe(true);
    localHereTarget({ state: 'known', path: '/usr', source: 'shell' }, channels()).open();
    expect(made().homeIfMissing).toBeUndefined();
  });

  it('asks for no directory when the terminal it was opened from could not say where it is, so that the host starts it in home, and says so in the status', () => {
    localHereTarget({ state: 'unknown', reason: 'query-failed' }, channels()).open();
    expect(made()).not.toHaveProperty('launch');
    expect(made().startNote).toBe('home-for-unknown-directory');
  });

  it('is the target of the `+` in every other way: called Terminal until the host names the shell, under the id of its session, on the channels and with the lease it was given', () => {
    const given = channels();
    const target = localHereTarget({ state: 'known', path: '/usr', source: 'shell' }, given, 90_000);
    expect(target).toMatchObject({ plugin: HOST, id: 'local', title: 'Terminal' });
    expect(target.retitle?.({ program: 'zsh' } as never)).toBe('zsh');
    expect(localHereTarget({ state: 'unknown' }, given).sessionId).not.toBe(target.sessionId);
    target.open();
    const options = made();
    expect(options.channels).toBe(given);
    expect(options.newId?.()).toBe(target.sessionId);
    expect(options.leaseMs).toBe(90_000);
  });
});

describe('the target of "New terminal"', () => {
  it('is the host\'s own terminal, called Terminal until the host says which shell it started, with an id of its own for the session that shows it', () => {
    const target = localShellTarget(channels());
    expect(target).toMatchObject({ plugin: HOST, id: 'local', title: 'Terminal' });
    expect(typeof target.sessionId).toBe('string');
    expect(target.sessionId).not.toBe('');
    expect(localShellTarget(channels()).sessionId).not.toBe(target.sessionId);
  });

  it('is named by the shell the host says it started', () => {
    const target = localShellTarget(channels());
    expect(target.retitle?.({ program: 'zsh' } as never)).toBe('zsh');
  });

  it('starts nothing until it is opened, and opens a feed that starts under the id of its session, on the channels it was given', () => {
    const given = channels();
    const target = localShellTarget(given);
    expect(createExecFeed).not.toHaveBeenCalled();
    expect(target.open()).toBe(feed);
    expect(createExecFeed).toHaveBeenCalledTimes(1);
    const options = made();
    expect(options.channels).toBe(given);
    expect(options.newId?.()).toBe(target.sessionId);
    expect(options.attach).toBeUndefined();
    expect(options).not.toHaveProperty('leaseMs');
  });

  it('gives the feed the lease it was asked for, and none when it was not asked', () => {
    localShellTarget(channels(), 90_000).open();
    expect(made().leaseMs).toBe(90_000);
  });

  it('uses the app\'s channels when it is given none', () => {
    const app = channels();
    vi.mocked(appTerminalChannels).mockReturnValue(app);
    localShellTarget().open();
    expect(made().channels).toBe(app);
  });

  it('has no page key and asks the feed for none: the capability is the channel\'s alone', () => {
    localShellTarget(channels()).open();
    expect(made()).not.toHaveProperty('pageKey');
    expect(made()).not.toHaveProperty('transport');
  });
});

describe('the target of a terminal the host keeps', () => {
  it('has the terminal\'s id as the id of its session, and the shell it runs as its title: Terminal when none is named', () => {
    expect(attachLocalTerminal('term-7', 'zsh', channels())).toMatchObject({ plugin: HOST, id: 'local', title: 'zsh', sessionId: 'term-7' });
    expect(attachLocalTerminal('term-8', undefined, channels())).toMatchObject({ title: 'Terminal', sessionId: 'term-8' });
  });

  it('attaches nothing by being made, and opens a feed that attaches to the terminal, each time it is opened: the program only when it is known', () => {
    const given = channels();
    const target = attachLocalTerminal('term-7', 'zsh', given);
    expect(createExecFeed).not.toHaveBeenCalled();
    expect(target.open()).toBe(feed);
    expect(made().channels).toBe(given);
    expect(made().attach).toStrictEqual({ id: 'term-7', program: 'zsh' });
    target.open();
    expect(createExecFeed).toHaveBeenCalledTimes(2);
    attachLocalTerminal('term-8', undefined, given).open();
    expect(made().attach).toStrictEqual({ id: 'term-8' });
  });

  it('is named by the shell the host says it runs', () => {
    expect(attachLocalTerminal('term-7', undefined, channels()).retitle?.({ program: 'bash' } as never)).toBe('bash');
  });

  it('uses the app\'s channels when it is given none', () => {
    const app = channels();
    vi.mocked(appTerminalChannels).mockReturnValue(app);
    attachLocalTerminal('term-7', 'zsh').open();
    expect(made().channels).toBe(app);
  });
});

describe('the terminals a page that reloaded finds again', () => {
  it('are those the channels list, one target for each, in the order the host gave them, each titled by its shell', async () => {
    const given = channels([
      { id: 'b', shell: { name: 'bash' } },
      { id: 'a', shell: { name: 'zsh' } },
      { id: 'c', shell: { name: '' } },
    ]);
    const targets = await restoreLocalTerminals(given);
    expect(targets.map((target) => [target.sessionId, target.title])).toEqual([
      ['b', 'bash'],
      ['a', 'zsh'],
      ['c', 'Terminal'],
    ]);
    expect(targets.every((target) => target.plugin === HOST && target.id === 'local')).toBe(true);
    expect(given.list).toHaveBeenCalledTimes(1);
    expect(createExecFeed).not.toHaveBeenCalled();
  });

  it('say ended for a terminal whose shell ended while no page held it, and say nothing for one that runs', async () => {
    const targets = await restoreLocalTerminals(
      channels([
        { id: 'run', shell: { name: 'zsh' } },
        { id: 'done', shell: { name: 'zsh' }, ended: { reason: 'exited' } },
        { id: 'none', shell: { name: 'zsh' }, ended: null },
      ]),
    );
    expect(targets.map((target) => target.ended)).toEqual([undefined, true, undefined]);
    expect(targets[0]).not.toHaveProperty('ended');
    expect(targets[2]).not.toHaveProperty('ended');
  });

  it('attach to their terminal when they are opened', async () => {
    const given = channels([
      { id: 'a', shell: { name: 'zsh' } },
      { id: 'c', shell: { name: '' } },
    ]);
    const [first, second] = await restoreLocalTerminals(given);
    first?.open();
    expect(made().attach).toStrictEqual({ id: 'a', program: 'zsh' });
    expect(made().channels).toBe(given);
    second?.open();
    expect(made().attach).toStrictEqual({ id: 'c' });
  });

  it('skip an entry that names no terminal', async () => {
    const targets = await restoreLocalTerminals(channels([null, 5, {}, { id: '' }, { id: 7 }, { id: 'ok', shell: { name: 'zsh' } }]));
    expect(targets.map((target) => target.sessionId)).toEqual(['ok']);
  });

  it('use the app\'s channels when they are given none', async () => {
    const app = channels([{ id: 'a', shell: { name: 'zsh' } }]);
    vi.mocked(appTerminalChannels).mockReturnValue(app);
    const targets = await restoreLocalTerminals();
    expect(targets.map((target) => target.sessionId)).toEqual(['a']);
  });

  it('reject with the host\'s own error when the host refuses the listing', async () => {
    const refusal = new Error('the host refused');
    const given = channels();
    given.list.mockRejectedValue(refusal);
    await expect(restoreLocalTerminals(given)).rejects.toBe(refusal);
  });
});

describe('the name of a terminal the host started', () => {
  const profile = { name: 'zsh', path: '/usr/bin/zsh', args: ['-f'], env: { A: '1' }, cwd: '/work' };
  const targets = {
    'the `+`': () => localShellTarget(channels()),
    'a profile': () => localProfileTarget(profile, channels()),
    'new terminal here': () => localHereTarget({ state: 'known', path: '/usr', source: 'shell' }, channels()),
    'a terminal the host keeps': () => attachLocalTerminal('term-7', undefined, channels()),
  };

  for (const [name, make] of Object.entries(targets)) {
    it(`is the title a program set while it runs and the shell's name otherwise, for ${name}`, () => {
      const { retitle } = make();
      expect(retitle?.({ program: 'zsh', title: 'vim: notes' } as never)).toBe('vim: notes');
      expect(retitle?.({ program: 'zsh' } as never)).toBe('zsh');
    });
  }
});

describe('the target of a terminal that stands in for an ended one (restart, #695 step 5)', () => {
  const ended = { id: 'old-terminal', command: ['/usr/bin/zsh', '-l'], cwd: '/work', env: { A: '1' } } as const;

  it('is the tab of the ended terminal\'s session, so the tab keeps its place: the session id is the tab\'s, and the terminal\'s id is another', () => {
    const target = localRestartTarget(ended, 'tab-3', channels(), () => 'fresh-1');
    expect(target).toMatchObject({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: 'tab-3' });
    target.open();
    expect(made().newId?.()).toBe('fresh-1');
  });

  it('asks the host for the ended terminal\'s shell, arguments, directory and environment, and for the directory to fall back to home when it was removed since', () => {
    localRestartTarget(ended, 'tab-3', channels(), () => 'fresh-1').open();
    expect(made().launch).toEqual({ command: ['/usr/bin/zsh', '-l'], cwd: '/work', env: { A: '1' } });
    expect(made().homeIfMissing).toBe(true);
  });

  it('asks for what it is given and for nothing else: no shell is the host\'s default, no directory and no environment are the host\'s own choices', () => {
    localRestartTarget({ id: 'old-terminal' }, 'tab-3', channels(), () => 'fresh-1').open();
    expect(made().launch).toEqual({});
    expect(made()).not.toHaveProperty('homeIfMissing');
  });

  it('attaches the tab to the new terminal, which the host lists back with it', () => {
    localRestartTarget(ended, 'tab-3', channels(), () => 'fresh-1').open();
    expect(made().tab).toBe('tab-3');
  });

  it('never makes the id of the ended terminal again: an id that is the same is asked for another', () => {
    const answers = ['old-terminal', 'old-terminal', 'fresh-2'];
    localRestartTarget(ended, 'tab-3', channels(), () => answers.shift() ?? 'never').open();
    expect(made().newId?.()).toBe('fresh-2');
  });

  it('is not opened by an id source that answers the ended terminal\'s id for ever: it refuses, so that no host meets the id again', () => {
    const target = localRestartTarget(ended, 'tab-3', channels(), () => 'old-terminal');
    expect(() => target.open()).toThrow(/id/);
    expect(createExecFeed).not.toHaveBeenCalled();
  });

  it('never answers the id of the tab either: a tab and the terminal of a restart are told apart', () => {
    const answers = ['tab-3', 'fresh-3'];
    localRestartTarget(ended, 'tab-3', channels(), () => answers.shift() ?? 'never').open();
    expect(made().newId?.()).toBe('fresh-3');
  });

  it('is named by the title a program set while it runs and the shell\'s name otherwise, as every terminal of the host is', () => {
    const { retitle } = localRestartTarget(ended, 'tab-3', channels(), () => 'fresh-1');
    expect(retitle?.({ program: 'zsh', title: 'vim: notes' } as never)).toBe('vim: notes');
    expect(retitle?.({ program: 'zsh' } as never)).toBe('zsh');
  });

  it('uses the app\'s channels when it is given none', () => {
    const app = channels();
    vi.mocked(appTerminalChannels).mockReturnValue(app);
    localRestartTarget(ended, 'tab-3').open();
    expect(made().channels).toBe(app);
  });
});

describe('the terminals a page that reloaded finds again: the tab, the shell and what they were started with (`params`)', () => {
  const listed = (id: string, extra: Record<string, unknown> = {}) => ({ id, shell: { name: 'zsh', path: '/usr/bin/zsh' }, ...extra });

  it('belong to the tab the host lists for them (`params.tab`), so that a restarted terminal finds the tab it replaced; with none the tab is the terminal\'s own id', async () => {
    const targets = await restoreLocalTerminals(channels([listed('fresh', { params: { tab: 'tab-3' } }), listed('plain', { params: {} }), listed('bare')]));
    expect(targets.map((target) => target.sessionId)).toEqual(['tab-3', 'plain', 'bare']);
  });

  it('attach to their terminal by its own id and say the shell\'s path and what it was started with, once they are opened', async () => {
    const launch = JSON.stringify({ command: ['/usr/bin/zsh', '-l'], env: { A: '1' } });
    const [target] = await restoreLocalTerminals(channels([listed('fresh', { params: { tab: 'tab-3', launch } })]));
    target?.open();
    expect(made().attach).toStrictEqual({ id: 'fresh', program: 'zsh', shell: '/usr/bin/zsh', launch: { command: ['/usr/bin/zsh', '-l'], env: { A: '1' } } });
  });

  it('say nothing of a launch the listing does not have, and attach as before', async () => {
    const [target] = await restoreLocalTerminals(channels([{ id: 'a', shell: { name: 'zsh' } }]));
    target?.open();
    expect(made().attach).toStrictEqual({ id: 'a', program: 'zsh' });
  });

  it.each([
    ['a launch that is not JSON', 'not json'],
    ['a launch that is not an object', '[1]'],
    ['a command that is not a list of words', JSON.stringify({ command: 'zsh', env: { A: '1' } })],
    ['a command with a word that is not text', JSON.stringify({ command: ['zsh', 7] })],
    ['an environment that is not names and text', JSON.stringify({ env: 'A=1' })],
  ])('read nothing of %s, which anyone who can name a terminal may have attached', async (_what, launch) => {
    const [target] = await restoreLocalTerminals(channels([listed('a', { params: { launch } })]));
    target?.open();
    expect(made().attach).not.toHaveProperty('launch');
  });

  it('keep the entries of an environment that are text and drop the others', async () => {
    const launch = JSON.stringify({ env: { A: '1', B: 2, C: null, D: '' } });
    const [target] = await restoreLocalTerminals(channels([listed('a', { params: { launch } })]));
    target?.open();
    expect(made().attach?.launch).toEqual({ env: { A: '1', D: '' } });
  });

  it.each([
    ['an empty one', ''],
    ['one that is not text', 7],
  ])('take the terminal\'s own id for the tab when the tab it lists is %s', async (_what, tab) => {
    const targets = await restoreLocalTerminals(channels([listed('a', { params: { tab } })]));
    expect(targets.map((target) => target.sessionId)).toEqual(['a']);
  });

  it('make one target for a tab two terminals say they belong to, the one that runs: the ended one the restart replaced may still be listed', async () => {
    const targets = await restoreLocalTerminals(
      channels([
        listed('old', { params: { tab: 'tab-3' }, ended: { reason: 'exited' }, created_at: '2026-11-26T10:00:00Z' }),
        listed('fresh', { params: { tab: 'tab-3' }, created_at: '2026-11-26T11:00:00Z' }),
        listed('other', { params: {} }),
      ]),
    );
    expect(targets.map((target) => [target.sessionId, target.ended])).toEqual([['tab-3', undefined], ['other', undefined]]);
    targets[0]?.open();
    expect(made().attach).toMatchObject({ id: 'fresh' });
  });

  it('make one target for a tab two terminals that ended say they belong to, the one made last, whichever the host lists first', async () => {
    const targets = await restoreLocalTerminals(
      channels([
        listed('newer', { params: { tab: 'tab-3' }, ended: { reason: 'exited' }, created_at: '2026-11-26T11:00:00Z' }),
        listed('older', { params: { tab: 'tab-3' }, ended: { reason: 'exited' }, created_at: '2026-11-26T10:00:00Z' }),
      ]),
    );
    expect(targets).toHaveLength(1);
    targets[0]?.open();
    expect(made().attach).toMatchObject({ id: 'newer' });
  });
});

describe('review of #791: which of two ended terminals of a tab is the later, by instant', () => {
  const ended = (id: string, madeAt: string) => ({ id, shell: { name: 'zsh' }, params: { tab: 'tab-3' }, ended: { reason: 'exited' }, created_at: madeAt });

  it.each([
    ['a fraction trimmed of its zeros', '2026-11-26T10:00:00Z', '2026-11-26T10:00:00.1Z'],
    ['fractions of different length', '2026-11-26T10:00:00.12Z', '2026-11-26T10:00:00.2Z'],
    ['nanoseconds', '2026-11-26T10:00:00.123456789Z', '2026-11-26T10:00:00.123456790Z'],
  ])('keeps the one made last whichever is listed first: %s', async (_what, older, newer) => {
    for (const order of [[ended('old', older), ended('new', newer)], [ended('new', newer), ended('old', older)]]) {
      const [target] = await restoreLocalTerminals(channels(order));
      target?.open();
      expect(made().attach).toMatchObject({ id: 'new' });
    }
  });
});

describe('review of #791: a replaced shell is listed with what was asked for it', () => {
  it('says the shell was replaced when the listing names the shell that was asked for, so that a restart gives its arguments to nobody', async () => {
    const launch = JSON.stringify({ command: ['/opt/gone/zsh', '--no-rcs'] });
    const [target] = await restoreLocalTerminals(channels([{ id: 'a', shell: { name: 'bash', path: '/bin/bash', requested: '/opt/gone/zsh' }, params: { launch } }]));
    target?.open();
    expect(made().attach).toMatchObject({ replaced: true });
  });
});
