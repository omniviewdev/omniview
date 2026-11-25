// The Ports tool against the mock's, as a probe of its own (ports-run.mjs, `PART=a`; the sections are in ports.mjs, which has its own header): the table's geometry measured against the mock's Ports tool (mock-ports.json): its five columns in order, the
// header, the rows of 24 px, the paddings, the mapping in the code face, the buttons of a row and the footer's count (geometry); and what a row says of its forward: the words, the glyph of each state, the second line, the connection's name and a
// name that is long (states). Everything is in ports-run.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/ports-a-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of ports-run.mjs applies)
process.env.PART = 'a';
await import('./ports-run.mjs');
