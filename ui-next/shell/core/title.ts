// Where a tab's title is cut when it does not fit (ch16 S17, ch12 section 7), as the mock's strip does it (`splitTitle` in shell-tabs.js): the title is drawn in two parts, a head that
// gives way with an ellipsis and a tail that keeps its end, so `{name} · {Kind}` and a long name still show what they end with. CSS decides where the cut falls (nothing is measured);
// this decides only where the two parts meet. Framework-free.

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

/** The grapheme clusters of a text, so an emoji or an accented letter is never split. */
const graphemes = (text: string): string[] => (segmenter === undefined ? Array.from(text) : Array.from(segmenter.segment(text), (part) => part.segment));

/** A title of this many graphemes or fewer is one part. */
const WHOLE = 12;
/** The longest tail the midpoint rule makes, in graphemes. */
const MAX_TAIL = 10;
/** A tail that starts at a separator is at most this long, separator included. */
const MAX_SEPARATED = 18;

/**
 * The head and the tail of a title. A short title is all head. Otherwise the cut is the last `/` or `:` when the part after it is short enough (the separator stays in the tail), else
 * the title's midpoint, with a tail of at most ten graphemes.
 */
export function splitTitle(text: string): readonly [head: string, tail: string] {
  const parts = graphemes(text);
  if (parts.length <= WHOLE) {
    return [text, ''];
  }

  for (const mark of ['/', ':']) {
    const at = text.lastIndexOf(mark);
    if (at > 0 && at < text.length - 1 && text.length - at <= MAX_SEPARATED) {
      return [text.slice(0, at), text.slice(at)];
    }
  }

  const tail = Math.min(MAX_TAIL, Math.ceil(parts.length / 2));
  return [parts.slice(0, parts.length - tail).join(''), parts.slice(parts.length - tail).join('')];
}
