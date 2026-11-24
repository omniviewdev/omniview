// The context menu of the terminal, as a probe of its own (terminal-probe.mjs, `PART=find-c`; the sections are in terminal-find.mjs, which has its own header): the pointer, Shift+F10 and the Menu key open it with exactly its items, Copy is
// unavailable until something is selected, each item does what it says to the stubbed clipboard, the screen and the find, and Escape gives the keyboard back to the terminal (menu.open); a program that has the mouse gets the right click and no menu
// opens, unless Shift is held, and with the mouse given back the menu opens (menu.mouse); and axe finds nothing in the open menu (axe.menu). Everything is in terminal-probe.mjs; this file says only which part runs.
//
//   node ui-next/shell/probes/terminal-find-c-probe.mjs     WebKit and Chromium at 1440 x 900 and 1280 x 800 (the environment of terminal-probe.mjs applies)
process.env.PART = 'find-c';
await import('./terminal-probe.mjs');
