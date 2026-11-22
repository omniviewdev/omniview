// The words the Plugins page says that are the host's own, in the house voice (a full sentence with contractions, ch16 X3). The state sentences of a plugin that stopped, did not start or timed out are NOT here: they are
// the window's (`ui-next/plugins/loader/failure.ts`, the same ones the rail's tip and a failed tab say), so one failure is worded one way on every surface.

/** What the header's chip says of a plugin that runs: the list says nothing of one (its row has no chip), so the state has no word of its own. */
export const RUNNING = 'Running';

/** What a plugin that is in one of these states is told, under its headline. */
export const SENTENCES = {
  running: 'The plugin is running. Its pages open as usual.',
  starting: 'The plugin is starting. The page opens when it is ready.',
  recovering: 'The host is starting the plugin again after it stopped. The page opens when it is ready.',
  stopping: 'The plugin is stopping, so its pages can\'t open.',
  degraded: 'The plugin is running, but some of its calls fail. Some pages may not work.',
  disabled: 'Enable it to open its pages.',
  stopped: 'Start it to open its pages.',
  removing: 'The plugin is being removed.',
  unknown: 'The host reports a state that this version of the app does not know.',
  build: 'The development build failed, so the plugin can\'t start.',
} as const;

/** What the Uninstall confirm says (ch16 S136), word for word the host's, and TRUE of what the host does (`backend/pkg/plugin/installer.go`, `docs/plugin-development.md` on uninstall): the plugin's whole directory is removed, with the connection profiles and the credentials the host saved there; the credential-class settings are erased from the host's settings store; the settings the plugin declares stay. There is no option on the host's call, so there is no choice to offer. */
export type UninstallWords = {
  readonly title: string;
  /** The primary button: what the person is doing. */
  readonly confirm: string;
  readonly intro: string;
  readonly sections: ReadonlyArray<{ readonly heading: string; readonly text: string }>;
};

/** The words of the confirm for a plugin with `tabs` open tabs in this window. A plugin that is linked from a source folder is unlinked, and its folder is never touched. */
export function uninstallWords(name: string, devMode: boolean, tabs: number): UninstallWords {
  const open =
    tabs === 0 ? `No tabs of ${name} are open.` : `${String(tabs)} open ${tabs === 1 ? 'tab' : 'tabs'} of ${name} will stay open and say it is not installed.`;
  return {
    title: devMode ? `Unlink ${name}?` : `Uninstall ${name}?`,
    confirm: devMode ? 'Unlink' : 'Uninstall',
    intro: devMode ? 'Unlinking removes the link and the copied build files. Your source folder is never touched.' : `${name} stops and its files are removed.`,
    sections: [
      { heading: 'Open tabs', text: open },
      {
        heading: 'Connection profiles and credentials',
        text: devMode ? 'Its saved credentials are erased, so linking it again asks for them.' : 'Its connection profiles and the credentials it saved are erased and can\'t come back.',
      },
      { heading: 'Settings', text: 'The settings it declares are kept, so they come back if you install it again.' },
    ],
  };
}
