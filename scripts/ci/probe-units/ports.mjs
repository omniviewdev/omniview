// The Ports tool (PF1): the host's tool of port forwards, in the real host's window with NO plugin and a FAKE HOST of port forwards behind the real tool (ui-next/shell/probes/ports-fixture.tsx, which invents only the host: the networker's two calls,
// its events, the way to open an address and the names of connections), in a production build of the fixture (the measurements) and a development one (React's Profiler counts commits there), against the mock's own Ports tool
// (ui-next/shell/probes/mock-ports.json, measured by mock-ports-measure.mjs from the tree it names). The sections are in ui-next/shell/probes/ports.mjs, which has its own header; ports-run.mjs runs them; the five probes
// ports-a-probe.mjs to ports-e-probe.mjs say which part runs. WebKit and Chromium at 1440 x 900 and 1280 x 800, and every control in Chromium at both.
//
// PF2: the tool shows what the producer states (the SDK's session states a port and no host), so its Mapping, Open in browser and Copy are its own words and differ from the mock's on purpose: the five forwards of the mock's own measurement state `127.0.0.1` in the probe's
// data so that every comparison with the mock keeps its meaning, and the section `hosts` (in the probe c) holds the tool's own words for every way of stating a host, or not, and records how they differ.
//
// THE FAMILY IS FIVE PROBES AND SIX UNITS OF CONTROLS. A section waits for a state and never for a time, so a probe takes 1 to 8 s for each section at each of the four sizes: the geometry and the states of a row (a), what the buttons and the menu of a row
// do (b: the tips and the check mark that goes back by itself are the slow ones), the keyboard and the empty, loading and failed states (c), what the tool costs (d) and axe (e). The units of controls are by what a control costs: each control is a
// process that runs its section alone at both viewports, so a unit holds as many as take about a minute and a half. Nothing here comes near the 216 s that half a shard is.
//
// THE SECONDS ARE THE LAPTOP'S TIMES 1.3, builds included (the first process of a shard builds the fixture, twice for a probe that needs the development build, and the others read the build: `BUILD_CACHE`), at a load under 30 (docs/ui-next/status/PF1.md
// has the uptime of the runs), until a runner has measured them: the sections of CI run on a machine that was 1.15 to 1.24 times slower than the laptop for the other probes. What is held in counts and not in milliseconds: the rows are 24 px, a frame commits at
// most twice, a press asks the host once; the only waits are for a condition, with a limit that is never what a passing run takes.

export const units = [
  {
    id: 'ports-a',
    name: 'Probe that the Ports tool is the mock\'s table: its columns and where they stand with names and without, header, rows, paddings, mapping, buttons and footer, and the words, glyphs, second line and names of a row',
    script: 'ui-next/shell/probes/ports-a-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/ports-a-probe.json' },
    seconds: 16,
  },
  {
    id: 'ports-b',
    name: 'Probe that the buttons of a row are real, named and tipped, say why they cannot be used, call the host once for a press, and that the row menu opens by the pointer and the keyboard and gives the keyboard back',
    script: 'ui-next/shell/probes/ports-b-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/ports-b-probe.json' },
    seconds: 49,
  },
  {
    id: 'ports-c',
    name: 'Probe that a row\'s buttons are one Tab stop with the arrows inside, that the keyboard is not lost when its row goes, what the empty, loading and failed states say and offer, and the footer\'s words',
    script: 'ui-next/shell/probes/ports-c-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/ports-c-probe.json' },
    seconds: 23,
  },
  {
    id: 'ports-d',
    name: 'Probe what the Ports tool costs: nothing at rest, nothing while it is not shown, and a commit or two a frame for a flood of 500 events',
    script: 'ui-next/shell/probes/ports-d-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/ports-d-probe.json' },
    seconds: 36,
  },
  {
    id: 'ports-e',
    name: 'Probe that axe finds nothing in the Ports tool: its table, its loading, failed and empty states and its row menu',
    script: 'ui-next/shell/probes/ports-e-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/ports-e-probe.json' },
    seconds: 10,
  },

  // The faults of the Ports probe, each in Chromium at both viewports, in six units by the sections they belong to (each is a process for each control, which runs its section alone): the table's geometry and what a row says (the first); the buttons of a row
  // (the second); the row menu (the third); the keyboard and the empty, loading and failed states (the fourth); what the tool costs (the fifth); axe (the sixth).
  {
    id: 'ports-controls-a',
    name: 'Probe that the Ports probe sees a table that is not the mock\'s: columns that change places or stand where the mock\'s do not (with names and without), a header, a row, a padding and a gap that are not its numbers, a mapping that is not in the code face, a count that is wrong, and a row that says the wrong thing',
    script: 'ui-next/shell/probes/ports-a-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['columns-swapped', 'header-tall', 'row-tall', 'padding-mapping', 'mapping-face', 'actions-gap', 'footer-count', 'word-edited', 'icon-swapped', 'reason-text', 'reason-muted', 'names-ids', 'long-wraps', 'layout-mapping-wide', 'layout-status-wide', 'names-fitted', 'names-greedy', 'long-uncapped'],
    plants: 'page',
    seconds: 59,
  },
  {
    id: 'ports-controls-b',
    name: 'Probe that the Ports probe sees buttons that lost their name, draw the wrong glyph, cannot be reached, are offered to UDP, call the host twice or for the wrong forward, or say it twice',
    script: 'ui-next/shell/probes/ports-b-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['button-nameless', 'glyph-wrong', 'disabled-native', 'udp-open', 'open-twice', 'open-wrong', 'copy-twice', 'announce-twice', 'close-twice', 'close-other', 'confirm-stale'],
    plants: 'page',
    seconds: 188,
  },
  {
    id: 'ports-controls-menu',
    name: 'Probe that the Ports probe sees a row menu that lacks an item, that the keyboard cannot open and that loses the keyboard when it closes',
    script: 'ui-next/shell/probes/ports-b-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['menu-item-missing', 'trigger-keys-lost', 'escape-blurs'],
    plants: 'page',
    seconds: 36,
  },
  {
    id: 'ports-controls-c',
    name: 'Probe that the Ports probe sees a row with two Tab stops, arrows that do nothing, a keyboard dropped on the page when its row goes, a button that starts a forward, a count while loading, a retry that reads twice, a hint that is not the mock\'s size and a footer that says the wrong words',
    script: 'ui-next/shell/probes/ports-c-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['tabstop-extra', 'arrows-swallowed', 'focus-dropped', 'forward-button', 'loading-count', 'retry-twice', 'hint-size', 'footer-singular', 'footer-suffix-stuck', 'section-timeout', 'hosts-guessed', 'reach-unstated', 'endpoint-guessed'],
    plants: 'page',
    seconds: 67,
  },
  {
    id: 'ports-controls-d',
    name: 'Probe that the Ports probe sees a tool that works at rest, listens while it is hidden, asks for the list too soon or commits for each event of a flood',
    script: 'ui-next/shell/probes/ports-d-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['idle-timer', 'idle-commits', 'hidden-leak', 'names-leak', 'list-eager', 'flood-sync', 'idle-uncounted', 'flood-uncounted', 'hidden-stale', 'reconnect-ignored', 'wake-leak'],
    plants: 'page',
    seconds: 91,
  },
  {
    id: 'ports-controls-e',
    name: 'Probe that the Ports probe sees a violation in the table, in its loading, failed and empty states and in its row menu',
    script: 'ui-next/shell/probes/ports-e-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['axe-table', 'axe-states', 'axe-menu', 'axe-unstaged'],
    plants: 'page',
    seconds: 21,
  },
];
