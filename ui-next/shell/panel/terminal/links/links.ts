import type { Platform } from '../../../core/chords';

// The rules of a link in a terminal's output (T3a), as pure functions: the words a hover says, which click follows the link, and which addresses are followed at all. The hook (`useTerminalLinks.tsx`) draws the words
// and hands the address to the registry; the emulator only finds the link and reports the pointer.

/**
 * What a hover on a link says, in VS Code's own words (`terminalLinkManager.ts`: "Follow link", then the click that does it): Command and a click on a Mac, Control and a click elsewhere. The link is not followed by a plain click,
 * which is how a person selects text in the output, so the words must name the click that is.
 */
export function followWords(platform: Platform): string {
  return `Follow link (${platform === 'mac' ? 'cmd' : 'ctrl'} + click)`;
}

/**
 * Whether a click follows the link it is on. The emulator gives a click on a link to the host as it came, whatever keys were held: the host asks for Command on a Mac and Control elsewhere (VS Code's test, `isMacintosh ?
 * event.metaKey : event.ctrlKey`). Control with a click on a Mac is the secondary click, so it is not the modifier there.
 */
export function followsWith(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, platform: Platform): boolean {
  return platform === 'mac' ? event.metaKey : event.ctrlKey;
}

/**
 * Whether an address is one to follow: `http://` or `https://` and a host that parses. The emulator finds only these in the output, and the registry refuses the rest again before it asks the window to open anything, but a link can
 * name any scheme (a program writes what it likes) and another scheme starts another program on the machine, so the handler does not pass one on. The slashes are asked for as the registry asks for them: the address parser reads
 * `http:example.com` as a web address, and nothing that writes a link means it.
 */
export function isWebAddress(uri: string): boolean {
  if (!/^https?:\/\//i.test(uri)) {
    return false;
  }

  try {
    return new URL(uri).hostname !== '';
  } catch {
    return false;
  }
}
