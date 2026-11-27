import type { TerminalFeedSnapshot } from './feed';

// The quality tier of a terminal's shell integration (issue #694 step 6), derived on the page from two facts the producer states and never guessed: the host's word on the integration (`integration`) and whether the shell has proved
// itself with its nonce (`proven`: a command line or a directory came with it). Definitions are in docs/ui-next/status/T5-notice.md.
//
//   none   the host did not integrate this shell (off, skipped, failed) or says nothing of it: no command marks.
//   basic  the host started the shell with the integration (`on`, `unconfirmed`) and the shell has not yet proved itself: marks may come, none is vouched for.
//   rich   the shell proved itself: each command, its exit status, its directory and its time are the shell's own words.

export type IntegrationTier = 'none' | 'basic' | 'rich';

/** What the card and the screen reader say of the integration of a terminal. */
export type IntegrationWords = { readonly tier: IntegrationTier; readonly label: string; readonly text: string };

type Facts = Pick<TerminalFeedSnapshot, 'integration' | 'proven'>;

/** The tier of a terminal. A proof never makes a tier of a shell the host says it did not integrate. */
export function tierOf(status: Facts): IntegrationTier {
  const state = status.integration?.state;
  if (state !== 'on' && state !== 'unconfirmed') {
    return 'none';
  }

  return status.proven === true ? 'rich' : 'basic';
}

/** Why the host did not integrate a shell, in words: only the reasons this page knows, and a plain sentence for any other. */
const WHY: Readonly<Record<string, string>> = {
  command: 'the shell was asked to run a command, not to be a terminal.',
  arguments: 'the shell was given arguments the host does not know.',
  posix: 'the shell was started in POSIX mode, which does not read the files the integration uses.',
  powerlevel10k: 'powerlevel10k draws its own prompt and marks.',
  multiplexer: 'the host itself runs inside tmux or screen.',
  'unsupported-shell': 'the integration has no script for this shell yet.',
  'bash-too-old': 'this bash is too old for the integration.',
  'bash-version-unknown': 'the host could not tell which bash this is.',
  'setting-unreadable': 'the host could not read the setting, so it left the shell alone.',
  'no-ready': 'the shell did not say it loaded the integration.',
  setup: 'the host could not set the integration up.',
  'exited-early': 'the shell ended at once with the integration and was started again without it.',
};

/** The words of the tier, or `undefined` when the producer says nothing of the integration: a fact not told is not on the card. */
export function integrationWords(status: Facts): IntegrationWords | undefined {
  const { integration } = status;
  if (integration === undefined) {
    return undefined;
  }

  const tier = tierOf(status);
  switch (tier) {
    case 'rich':
      return { tier, label: 'Rich', text: 'Rich: the shell tells this terminal each command, its exit status, its directory and its time.' };
    case 'basic':
      return { tier, label: 'Basic', text: `Basic: the shell was started with the integration and has not ${integration.state === 'unconfirmed' ? 'said it loaded' : 'yet proved a command or a directory'}.` };
    case 'none':
      return { tier, label: 'None', text: `None: ${noneWhy(integration)}` };
  }
}

function noneWhy(integration: NonNullable<Facts['integration']>): string {
  if (integration.state === 'off') {
    return 'shell integration is turned off in Settings.';
  }

  const known = integration.reason !== undefined && Object.hasOwn(WHY, integration.reason) ? WHY[integration.reason] : undefined;
  if (known !== undefined) {
    return known;
  }

  return integration.state === 'failed' ? 'the shell did not come up with the integration.' : 'the host did not start this shell with the integration.';
}
