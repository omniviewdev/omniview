// The sidebar and the tab strip against the pinned mock (S3, the recorded tour's findings D4, D5, D7 and D8): the room a sidebar label gets beside its count in the mock's own tree (ui-next/shell/probes/mock-sidebar.json,
// measured by mock-sidebar-measure.mjs from the cases of names.mjs) and the tooltip of a name that is cut; where a tab's title is cut and what tells twin tabs apart in the mock's own strip (mock-strip-text.json,
// mock-strip-text-measure.mjs, strip-text-cases.mjs): faces of 208 px at most whatever the title, a head with an ellipsis and a tail that keeps its end, a scope only on a tab that another reads like; and the sidebar's groups
// after a plugin's unload and return on the host fixture. It builds its own fixtures, so it does not read PROBE_DIST.
const PROBE = ['ui-next/shell/probes/{tour-probe.mjs,names.mjs,strip-text-cases.mjs,mock-sidebar.json,mock-sidebar-measure.mjs,mock-strip-text.json,mock-strip-text-measure.mjs,fixture.*,host-fixture.*}'];

export const units = [
  {
    id: 'tour',
    name: 'Probe the sidebar labels, the tab titles and twins and the sidebar groups against the pinned mock reference',
    script: 'ui-next/shell/probes/tour-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/tour-probe.json' },
    seconds: 37,
    paths: [...PROBE, 'ui-next/shell/**', 'ui-next/plugins/{host,contract,fixture,loader}/**', 'ui-next/plugins/testing.ts', 'ui-next/page/**'],
  },

  // The negative controls of the tour probe: each makes the page do what one assertion is there to see (a sidebar whose count slot is four characters wide, as it was before S3, and a name that is cut and carries no clip
  // marker, so that the tooltip never has it; a title whose tail is not drawn; a tab that has no twin and draws a scope, and twin tabs that draw none; a sidebar that comes back after a plugin's unload as a tree that
  // remembered nothing would draw it) and passes only when that assertion sees it, Chromium at 1440 x 900, the section of the fault only. With ASSERTION_OFF=<control> the assertion is left out and the fault must pass
  // undetected. The first control builds the fixtures into BUILD_CACHE and the others read that build.
  {
    id: 'tour-controls',
    name: 'Probe that the tour probe sees a sidebar and a tab strip that are wrong',
    script: 'ui-next/shell/probes/tour-probe.mjs',
    env: { BUILD_CACHE: '$RUNNER_TEMP/tour-fixtures' },
    controls: ['slot-wide', 'names-no-tip', 'title-cut', 'twin-lone', 'twin-hidden', 'memory-lost'],
    seconds: 22,
    paths: [
      ...PROBE,
      'ui-next/shell/testing.tsx',
      'ui-next/shell/{Tree,Sidebar,Shell,TopRow}.*',
      'ui-next/shell/core/{tree,count,title}.ts',
      'ui-next/shell/{tabs,core/tabs,session}/**',
      'ui-next/plugins/host/**',
    ],
  },
];
