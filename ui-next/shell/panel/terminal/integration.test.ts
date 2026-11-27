import { describe, expect, it } from 'vitest';
import type { TerminalIntegrationState } from './feed';
import { integrationWords, tierOf } from './integration';

// THE TIER OF A TERMINAL'S SHELL INTEGRATION (issue #694 step 6). `none`: the shell tells this terminal nothing (turned off, skipped, failed, or the producer says nothing). `basic`: the host started the shell with the integration (or
// says it loaded) and the shell has not yet proved itself with its nonce: marks may come, none is vouched for. `rich`: the shell proved itself (a command line or a directory came with the nonce), so command lines, directories, exit
// status and times are the shell's own words. Derived from the producer's two facts; the page never reads a mark's trust itself.

const state = (value: TerminalIntegrationState, extra: { readonly reason?: string; readonly proven?: true } = {}) => ({ integration: { state: value, ...(extra.reason === undefined ? {} : { reason: extra.reason }) }, ...(extra.proven === undefined ? {} : { proven: extra.proven }) });

describe('the tier of a terminal', () => {
  it('is rich when the host started the shell with the integration and the shell proved itself, and basic until it has', () => {
    expect(tierOf(state('on', { proven: true }))).toBe('rich');
    expect(tierOf(state('on'))).toBe('basic');
  });

  it('is rich for an unconfirmed integration whose shell proved itself anyway, and basic while it has not said it loaded', () => {
    expect(tierOf(state('unconfirmed', { proven: true }))).toBe('rich');
    expect(tierOf(state('unconfirmed'))).toBe('basic');
  });

  it('is none when the integration is off, skipped or failed, and a proof cannot make it more: the host says the shell is not integrated', () => {
    for (const none of ['off', 'skipped', 'failed'] as const) {
      expect(tierOf(state(none)), none).toBe('none');
      expect(tierOf(state(none, { proven: true })), `${none} with a proof`).toBe('none');
    }
  });

  it('is none when the producer says nothing of the integration, whatever the marks say', () => {
    expect(tierOf({})).toBe('none');
    expect(tierOf({ proven: true })).toBe('none');
  });
});

describe('the words of the tier', () => {
  it('say nothing when the producer says nothing: a fact not told is not on the card', () => {
    expect(integrationWords({})).toBeUndefined();
    expect(integrationWords({ proven: true })).toBeUndefined();
  });

  it('name each tier in a word and say what it gives, in the producer\'s terms', () => {
    expect(integrationWords(state('on', { proven: true }))).toEqual({ tier: 'rich', label: 'Rich', text: 'Rich: the shell tells this terminal each command, its exit status, its directory and its time.' });
    expect(integrationWords(state('on'))).toEqual({ tier: 'basic', label: 'Basic', text: 'Basic: the shell was started with the integration and has not yet proved a command or a directory.' });
    expect(integrationWords(state('unconfirmed'))).toEqual({ tier: 'basic', label: 'Basic', text: 'Basic: the shell was started with the integration and has not said it loaded.' });
  });

  it('say why there is none, in words, for each reason the host gives, and plainly when it gives none', () => {
    expect(integrationWords(state('off'))?.text).toBe('None: shell integration is turned off in Settings.');
    expect(integrationWords(state('skipped', { reason: 'powerlevel10k' }))?.text).toBe('None: powerlevel10k draws its own prompt and marks.');
    expect(integrationWords(state('skipped', { reason: 'bash-too-old' }))?.text).toBe('None: this bash is too old for the integration.');
    expect(integrationWords(state('skipped', { reason: 'multiplexer' }))?.text).toBe('None: the host itself runs inside tmux or screen.');
    expect(integrationWords(state('skipped', { reason: 'command' }))?.text).toBe('None: the shell was asked to run a command, not to be a terminal.');
    expect(integrationWords(state('failed', { reason: 'exited-early' }))?.text).toBe('None: the shell ended at once with the integration and was started again without it.');
    expect(integrationWords(state('skipped', { reason: 'something-new' }))?.text, 'a reason this page does not know is not shown as the host gave it').toBe('None: the host did not start this shell with the integration.');
    expect(integrationWords(state('failed'))?.text).toBe('None: the shell did not come up with the integration.');
  });

  it('carry the tier the words are for, so that a card and a screen reader never disagree', () => {
    for (const status of [state('on', { proven: true }), state('on'), state('off'), state('skipped', { reason: 'posix' }), state('failed')]) {
      expect(integrationWords(status)?.tier).toBe(tierOf(status));
    }
  });
});
