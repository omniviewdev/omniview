// What the Ports tool costs, as a probe of its own (ports-run.mjs, `PART=d`; the sections are in ports.mjs, which has its own header): a table at rest asks for no timer and no frame, changes nothing of the document in the production build and
// commits nothing in the development build (idle: ports.idle); the tool listens to the host only while it is on screen, in the counts of the fake host's On and its removals (hidden: ports.hidden); and a flood of 500 events made and 500 closed,
// each in a task of its own, is drawn in at most two commits a frame and ends exact (flood: ports.flood). The development build is where React's Profiler counts commits. Everything is in ports-run.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/ports-d-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of ports-run.mjs applies)
process.env.PART = 'd';
await import('./ports-run.mjs');
