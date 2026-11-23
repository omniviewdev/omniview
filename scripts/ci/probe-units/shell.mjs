// The shell frame against the pinned mock reference (ui-next/shell/probes/mock-shell.json): the window, the top row, the rail, the sidebar, the island, the lane, the page and the status bar, at the reference's two viewports
// until the probe viewports switch (tracker row N23). It builds its own fixtures (the repository's `vite build` of ui-next/shell/probes/*.html, once for production and once for React's development build, which the commit
// counts read), so it does not read PROBE_DIST. Linux Chromium needs the hinting flag the kit probes use, which the probes pass themselves. It has no negative controls.
export const units = [
  {
    id: 'shell',
    name: 'Probe the shell frame against the pinned mock reference',
    script: 'ui-next/shell/probes/shell-probe.mjs',
    env: { REPORT: '$RUNNER_TEMP/shell-probe.json' },
    seconds: 60,
  },
];
