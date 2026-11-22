import { describe, expect, it } from 'vitest';
import { uninstallWords } from './words';

// What the Uninstall confirm says. Each sentence is checked against what the host does (docs/plugin-development.md, "Uninstalling a plugin"): the plugin's whole directory goes, with the connection profiles and the credentials the
// host saved in it, the credential-class settings are erased, the settings the plugin declares are kept, and the host's call has no option, so the confirm offers none. The mock's confirm has a box that deletes the settings and
// profiles too and says the settings are kept; the host has neither, and the confirm says only what is true.

describe('uninstallWords', () => {
  it('says what stops, what is removed, what stays open and what comes back', () => {
    expect(uninstallWords('Alpha Metrics', false, 2)).toEqual({
      title: 'Uninstall Alpha Metrics?',
      confirm: 'Uninstall',
      intro: 'Alpha Metrics stops and its files are removed.',
      sections: [
        { heading: 'Open tabs', text: '2 open tabs of Alpha Metrics will stay open and say it is not installed.' },
        { heading: 'Connection profiles and credentials', text: 'Its connection profiles and the credentials it saved are erased and can\'t come back.' },
        { heading: 'Settings', text: 'The settings it declares are kept, so they come back if you install it again.' },
      ],
    });
  });

  it('counts the open tabs, one and none', () => {
    expect(uninstallWords('Alpha Metrics', false, 1).sections[0]?.text).toBe('1 open tab of Alpha Metrics will stay open and say it is not installed.');
    expect(uninstallWords('Alpha Metrics', false, 0).sections[0]?.text).toBe('No tabs of Alpha Metrics are open.');
  });

  it('says a plugin linked from a source folder is unlinked, and that its folder is never touched', () => {
    const words = uninstallWords('Alpha Metrics', true, 0);

    expect(words.title).toBe('Unlink Alpha Metrics?');
    expect(words.confirm).toBe('Unlink');
    expect(words.intro).toBe('Unlinking removes the link and the copied build files. Your source folder is never touched.');
    expect(words.sections[1]?.text).toBe('Its saved credentials are erased, so linking it again asks for them.');
  });

  it('offers no choice: the host\'s call has none, so there is no box that deletes more', () => {
    const text = JSON.stringify(uninstallWords('Alpha Metrics', false, 0));

    expect(text).not.toMatch(/delete its|also delete|choose/i);
  });
});
