// Where the web addresses are in a line of text printed in the output (#696 step 1): the same shape the emulator's own link finder reads (`@xterm/addon-web-links`: the scheme, then anything but a space, a quote or a bracket, and
// an end that is not punctuation, so that a full stop after an address is not part of it). It is used for the list of the links in view, for a person who has no pointer; the pointer's own links are the emulator's.
//
// The bound is the caller's: a line is cut at `MAX_LINE` characters before it is scanned, so that what an attacker can print costs a constant. Inside that, the pattern is tried at each `http` and reads to the end of the run
// of address characters once and gives back at most that run, so the work is at most the square of a bound.

/** The longest line scanned, in characters: the emulator's own cap for a link is 2,083 (the address of a hyperlink), and a line of more than this is output, not text. */
export const MAX_LINE = 2048;

/** The longest address listed: the one the emulator accepts for a hyperlink. */
export const MAX_TARGET = 2083;

const WEB = /https?:\/\/[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/giu;

/** The web addresses in `text` with the offset of each, in order. Only the first `MAX_LINE` characters are read. */
export function webAddressesIn(text: string): ReadonlyArray<{ readonly index: number; readonly uri: string }> {
  const found: Array<{ index: number; uri: string }> = [];
  for (const match of text.slice(0, MAX_LINE).matchAll(WEB)) {
    if (match[0].length <= MAX_TARGET) {
      found.push({ index: match.index, uri: match[0] });
    }
  }

  return found;
}

/** Whether a hyperlink's target is one to list: `http` or `https`, with something after the slashes, and not longer than the emulator takes. */
export function isListedTarget(uri: string): boolean {
  return uri.length <= MAX_TARGET && /^https?:\/\/[^\s\p{Cc}\\]+$/iu.test(uri);
}
