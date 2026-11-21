// What a plugin's providers do to the command palette (C1c), and what its sidebar's keywords do to the pages it can go to (C1e): the `plugins` section of palette-probe.mjs on its own, with its negative controls
// (slow-blocks, quick-late, focus-moves, extra-commit, plugin-shift, closed-work, stale-shown, alias-ignored, alias-loose). It is a script of its own so that CI can run it in a shard of its own: the palette probe is one of the longest probes, and this section is four more pairs of an engine and a viewport,
// about 150 s. Everything is in palette-probe.mjs (the engines and viewports, the controls' table, the report) and palette-plugins.mjs (the parts); this file says only which section runs.
//
//   node ui-next/shell/probes/palette-plugins-probe.mjs                          WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of palette-probe.mjs applies)
//   NEGATIVE_CONTROL=<name> node ui-next/shell/probes/palette-plugins-probe.mjs   one negative control: the part it perturbs runs in Chromium at 1440 x 900, and the probe must see it
process.env.SECTIONS = 'plugins';
await import('./palette-probe.mjs');
