// What the providers a plugin brings do to the command palette (C1c): the host's own wiring of the fixture plugin's providers (ui-next/shell/probes/palette-plugins-fixture.tsx: the real shell, palette and tab model) in WebKit
// and Chromium at 1440 x 900 and 1280 x 800. What is judged does not depend on how fast the machine is: the order things happen in (the input shows its text before a slow provider answers, the fast provider's rows before
// the slow one's, the active row where the user left it when a late section arrives), what a key costs a page that a provider holds, the commits of a key and of an answer, nothing outside the palette moving, a closed
// palette doing no provider work, and the states (a provider that throws, never answers or answers after it was told to stop; a plugin that leaves while the palette is open), with axe. It builds its own fixtures, so it does
// not read PROBE_DIST.
const PROBE = ['ui-next/shell/probes/palette-*'];

export const units = [
  {
    id: 'palette-plugins',
    name: 'Probe what the providers of a plugin do to the command palette',
    script: 'ui-next/shell/probes/palette-plugins-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-plugins-probe.json' },
    seconds: 154,
    paths: [...PROBE, 'ui-next/shell/**', 'ui-next/plugins/{host,contract,fixture,loader}/**', 'ui-next/plugins/testing.ts', 'ui-next/page/detailIdentity.ts'],
  },

  // The negative controls of the plugin providers probe: each makes the page do what one assertion is there to see (a provider that holds the thread, a fast provider that answers late, a late section that takes the cursor
  // with it, a second commit for a key, a move outside the palette, work done while the palette is closed, an answer shown after the stop, a sidebar keyword that is not read or ranks as a plain keyword, a connection said by its
  // key in a row of the palette, and by the tab model's faces in the tab strip, its tooltip and the status bar) and passes only when that assertion sees it. Each runs the part it perturbs.
  {
    id: 'palette-plugins-controls',
    name: 'Probe that the plugin providers probe sees a palette that is wrong',
    script: 'ui-next/shell/probes/palette-plugins-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['slow-blocks', 'quick-late', 'focus-moves', 'extra-commit', 'plugin-shift', 'closed-work', 'stale-shown', 'alias-ignored', 'alias-loose', 'connection-key', 'connection-key-face'],
    seconds: 113,
    paths: [
      ...PROBE,
      'ui-next/shell/testing.tsx',
      'ui-next/shell/{palette,core/palette,tabs,core/tabs}/**',
      'ui-next/shell/StatusBar.*',
      'ui-next/plugins/host/{palette,paletteProviders,contributions,published,rail,route,connectionName,panel}.ts',
      'ui-next/plugins/contract/**',
      'ui-next/plugins/fixture/src/{palette,items}.ts',
      'ui-next/plugins/testing.ts',
    ],
  },
];
