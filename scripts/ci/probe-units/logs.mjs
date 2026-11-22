// The host's Logs tool (P1b-3a) on the host fixture (`?logs=1`): the log view fills the panel's body, opening a session moves nothing outside the log view, switching tool and back keeps the lines and the scroll place, what
// the plugin counts of its feed (the registry and the view listen while the session is on screen, only the registry while another tool is shown, none once the tab is closed), and what the 10,000 lines a second session
// costs: at most one commit a frame (and at least one) with the panel open (React's development build), and with the panel closed or another tool shown no commit, no frame requested, no timer started, no DOM mutation and
// (Chromium) no layout or style recalculation, WHILE THE FEED WENT ON, and back on the Logs tool the view shows newer lines than it had when it was hidden, with every line the feed made since accounted for, at 1440 x 900
// and 1280 x 800. The source of a line (L2): a session that follows two sources has a Source column whose cell on every row names the source the feed gave the line, one that follows one has none, and a column that
// appears while a session is open moves no row, scrolls nothing, measures nothing and (Chromium) lays the page out once. A plugin's unload (A21, on the host fixture's `window.__plugin`): the sessions of an item (one
// streams, one ended, one failed) stay in the same views with the oldest line each showed, each stream is closed once and the registry lets go of it, and closing the tabs leaves no listener; and, in Chromium, the heap
// after forced collections (CDP) falls back once the tab of a session that held 100,000 lines is closed. A Logs session is its plugin and its target (A22, section `identity`): pressing a target whose session is running
// shows it and starts no second stream, moves no focus, opens the panel and chooses Logs from a hidden panel or another tool; a twin of another scope makes both tabs draw their scope and closing one takes it off the other;
// a target whose session ended or failed opens a new session beside it, the tabs named `x, ended` and `x (2)`; and (section `a11y`) axe on the real log view with the scoped twin tabs and with an ended session beside its
// replacement. The toolbar (P1b-4a, section `toolbar`): the column and its five buttons, their glyphs and paint, against the mock's own measurement (mock-logs-toolbar.json, both engines), their names, states, tooltips and
// reasons, the keys of a vertical toolbar, Pause that holds the stream and counts the lines it holds, Follow, Clear, Copy that writes every line the list draws with its source, UTC, what a session chose and keeps, the level
// filter, and a panel too short for every button, where the last buttons are behind the `⋯` More actions menu. It builds its own fixtures, so it does not read PROBE_DIST.
const PROBE = ['ui-next/shell/probes/{logs-probe.mjs,host-fixture.*,mock-logs-toolbar.json,mock-logs-toolbar-measure.mjs}'];
const KIT = ['packages/kit/src/components/{LogView,IconButton,RovingGroup}/**', 'packages/kit/src/log/**'];

export const units = [
  {
    id: 'logs',
    name: 'Probe the Logs tool in a real engine',
    script: 'ui-next/shell/probes/logs-probe.mjs',
    env: { REPORT: '$RUNNER_TEMP/logs-probe.json' },
    seconds: 395,
    paths: [...PROBE, ...KIT, 'ui-next/shell/**', 'ui-next/plugins/**', 'ui-next/page/**'],
  },

  // The negative controls of the Logs probe, first group: the feed goes quiet once the view is hidden, which a view that costs nothing because its feed is quiet would pass every zero of; every Source cell says the other
  // source's name; the list is scrolled 48 px when the column appears; every listener ever added to a Set is kept, so the model of a view outlives its closed tab and the heap does not fall back (A21); a stream is closed
  // twice, which the count of closed feeds does not see; a held view shows another line from the one it had (A21); a second press that starts a second stream, a tab with no twin that draws a scope, two tabs that carry one
  // name, a scoped tab whose name leaves its scope out, and the view of a session that ended and was pressed again showing another line from the one it had (A22; each is detected by its own check and by no other).
  {
    id: 'logs-controls-feed',
    name: 'Probe that the logs probe sees a feed that stopped, a wrong source and a list that moved',
    script: 'ui-next/shell/probes/logs-probe.mjs',
    controls: ['feed-stopped', 'source-label', 'column-moves', 'kept-leak', 'close-twice', 'kept-lines', 'second-stream', 'lone-scope', 'same-name', 'axe-name', 'over-lines'],
    seconds: 170,
    paths: [...PROBE, ...KIT, 'ui-next/shell/{panel,core/panel,session}/**', 'ui-next/plugins/{host,contract}/**', 'ui-next/plugins/fixture/src/logs.ts', 'ui-next/plugins/testing.ts'],
  },

  // The negative controls of the Logs probe, second group, the toolbar's (P1b-4a): the toolbar's column stands 3 px from where the mock's does, the view draws lines while the toolbar says paused, a copy names no source, the
  // count of lines after a Clear is one more than the stream made, a session's choice of UTC is lost when it comes back, the buttons read without the More button at the panel's least height, a Pause press costs one more
  // commit, and a toolbar that keeps its confirmation's clock while hidden changes the closed window.
  {
    id: 'logs-controls-toolbar',
    name: 'Probe that the logs probe sees a toolbar that is wrong',
    script: 'ui-next/shell/probes/logs-probe.mjs',
    controls: ['toolbar-moved', 'pause-leaks', 'copy-no-source', 'clear-miscount', 'state-lost', 'more-missing', 'pause-commits', 'toolbar-timer'],
    seconds: 212,
    paths: [...PROBE, ...KIT, 'ui-next/shell/{panel,core/panel}/**', 'ui-next/plugins/host/{PluginHost,panel,panelHost}.*', 'ui-next/plugins/fixture/src/logs.ts', 'ui-next/plugins/testing.ts'],
  },
];
