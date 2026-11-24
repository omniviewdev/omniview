# Shared ProgressBar (#679)

`@omniviewdev/kit` exports `ProgressBar` for named work with known or unknown completion. Use a numeric `value` for determinate work, and `value="indeterminate"` when no percentage is known. The latter omits `aria-valuenow`; an optional `valueText` describes the current phase. The part owns the 4 px themed track and CSS motion, not the operation's lifecycle, visible label, focus handoff or layout slot.

List/detail refresh still uses the page header's stripe; the plugin header uses the sweep. The examples run at `/?screen=parts&part=ProgressBar` in the `next` flavor. [WebKit screenshot](kit-progress-evidence/progress-bar-webkit.png).

## Dev tools and verification

`SHOTS_DIR=docs/ui-next/status/kit-progress-evidence node packages/kit/probes/progress-shots.mjs` builds the gallery and samples 60 animation frames per engine and motion setting. The sampled bar subtrees had zero DOM mutations in WebKit and Chromium; both engines stopped animating under reduced motion. This measures DOM changes, not GPU cost or native WKWebView performance. The plugin page's existing geometry and keyboard probes exercise the actual migrated header.
