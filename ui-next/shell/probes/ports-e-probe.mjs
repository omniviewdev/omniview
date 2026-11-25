// axe-core in the Ports tool, as a probe of its own (ports-run.mjs, `PART=e`; the sections are in ports.mjs, which has its own header): axe finds nothing in the table with a forward in every state (axe.table), in the tool while it loads, when the host
// could not be read and when it holds no forward (axe.states) and in the open menu of a row (axe.menu). Everything is in ports-run.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/ports-e-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of ports-run.mjs applies)
process.env.PART = 'e';
await import('./ports-run.mjs');
