// The buttons and the menu of a row of the Ports tool, as a probe of its own (ports-run.mjs, `PART=b`; the sections are in ports.mjs, which has its own header): the three buttons of a row are real buttons with names and tips and the glyphs the design
// wants where the registry has them (actions: ports.buttons, ports.glyphs), say why they cannot be used and make no call when pressed (ports.disabled), a forward over UDP is not offered Open in browser (ports.udp), Open in browser calls the way
// to open an address once with `http://127.0.0.1:<local port>` (ports.open), Copy address copies `127.0.0.1:<local port>` once and says "Address copied" once (ports.copy) and Stop asks the host to close the forward once and says Stopping
// (ports.stop); and the row menu opens by a right click, by Shift F10 and by the Menu key with the three items and gives the keyboard back on Escape (menu: menu.items, menu.keys, menu.escape). Everything is in ports-run.mjs; this file says
// only which part runs.
//
//   node ui-next/shell/probes/ports-b-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of ports-run.mjs applies)
process.env.PART = 'b';
await import('./ports-run.mjs');
