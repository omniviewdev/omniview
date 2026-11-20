// Text a plugin hands the model is bounded and cleaned before it is stored (S74: a title is at most 80 characters, a sentence at most 120; the host sanitises provider text). The rules are the
// mock's `line` and `block` (shell-notify.js) and the host's text gate (`apperror.PublicText`, docs/ui-next/status/E0-1.md): terminal escapes removed whole; control characters become a space
// (a line) or go (a block, which keeps its line ends); format characters (bidirectional overrides, zero-width, tags) and private-use characters go, so a title cannot be disguised; white
// space collapses; a cut ends with an ellipsis and never splits a character.

/** A terminal escape: a control sequence, or an operating-system command up to its terminator. */
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const FORMAT = /[\p{Cf}\p{Co}]/gu;
const CONTROL = /\p{Cc}/gu;
const BLOCK_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

const textOf = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');

/** `text` cut to `max` characters, the ellipsis included in the bound, never in the middle of a surrogate pair. */
function cut(text: string, max: number, ellipsis: boolean): string {
  if (text.length <= max) {
    return text;
  }

  let end = ellipsis ? max - 1 : max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }

  const head = text.slice(0, end);
  return ellipsis ? `${head.trimEnd()}…` : head;
}

/** One line of text: escapes and format characters gone, control characters and runs of white space one space, trimmed, cut at `max` with an ellipsis. Text and numbers only; anything else is nothing. */
export function line(value: unknown, max: number): string {
  const clean = textOf(value).replace(ESCAPES, '').replace(CONTROL, ' ').replace(FORMAT, '').replace(/\s+/g, ' ').trim();
  return cut(clean, max, true);
}

/** Diagnostics: the lines and the tabs stay, line ends become `\n`, everything else that is not text goes; cut at `max` without an ellipsis (it is a log, not a sentence). */
export function block(value: unknown, max: number): string {
  const clean = textOf(value).replace(/\r\n?/g, '\n').replace(ESCAPES, '').replace(BLOCK_CONTROL, '').replace(FORMAT, '');
  return cut(clean, max, false);
}

/** A plugin's id read as its name, when the host does not know a better one: `cloud` is `Cloud`. */
export const sentenceCase = (id: string): string => `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
