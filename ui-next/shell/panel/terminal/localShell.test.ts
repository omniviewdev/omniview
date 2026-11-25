import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST } from '../../core/panel';
import type { TerminalChannels } from './channel';
import { createExecFeed } from './execFeed';
import type { TerminalFeedHandle } from './feed';
import { attachLocalTerminal, localProfileTarget, localShellTarget, restoreLocalTerminals } from './localShell';
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
