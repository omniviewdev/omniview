// The title a program sets (OSC 0 and 2) is output of a shell or of a program: untrusted text. The host cleans and bounds it before it says it (backend/pkg/terminal/title.go); the page does it again for what it is handed, so that
// nothing that reaches a tab or an accessible name can carry an escape sequence, reorder the words, or be of any length.

/** The most a title keeps, in bytes of UTF-8 (the host's own bound). */
export const MAX_TITLE_BYTES = 256;

/** What a title never holds: controls (C0, DEL, C1), line and paragraph separators, invisible and bidirectional format characters (all of Cf but the joiner of an emoji sequence) and the fillers. */
const NOT_IN_A_TITLE = /[\p{Cc}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]|(?!\u200d)\p{Cf}/gu;

/** A UTF-16 unit of a surrogate pair that has no partner. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const encoder = new TextEncoder();

/** A title as a tab may carry it: no control character, a lone surrogate as U+FFFD, outer white space removed, cut at a character boundary to `MAX_TITLE_BYTES`. Empty when nothing is left. */
export function cleanTitle(raw: string): string {
  let out = '';
  let bytes = 0;
  for (const character of raw.replaceAll(NOT_IN_A_TITLE, '').replaceAll(LONE_SURROGATE, '\ufffd')) {
    const size = encoder.encode(character).length;
    if (bytes + size > MAX_TITLE_BYTES) {
      break;
    }

    out += character;
    bytes += size;
  }

  return out.trim();
}

/** The title frame of the host (`{v: 1, title, program}`, protocol section 4b) as far as it can be read: the cleaned title and whether a program runs. Anything else is nothing. */
export function titleOf(frame: unknown): { readonly title: string; readonly program: boolean } | undefined {
  if (typeof frame !== 'object' || frame === null || Reflect.get(frame, 'v') !== 1) {
    return undefined;
  }

  const title: unknown = Reflect.get(frame, 'title');
  const program: unknown = Reflect.get(frame, 'program');
  if (typeof title !== 'string' || typeof program !== 'boolean') {
    return undefined;
  }

  return { title: cleanTitle(title), program };
}
