import { LIMITS, type LabelPart, type Range } from './types';

// Matching and ranking of one text against the words of a query: a port of the design lab's matcher (`shell-search.js`, "Matching and ranking (S68, S71)"), kept as it is so that the
// palette ranks as the mock does, with the cost taken out of the path every candidate takes: no allocation for a text that cannot match, and the lower-cased text made once.
//
// Every word of the query must match (AND). A word matches a field whole (100), as a prefix of it (88), at the start of one of its words or at a CamelCase hump (76) or as a
// substring (58); in the TITLE only, also loosely: by its letters in order inside ONE word ("dply" is Deployments) or by the first letters of consecutive words ("ei" is EC2
// Instances). Letters that wander across words match nothing, so a stray command never ranks (QA-SF-26). A title weighs 6, keywords 3 and the context 1.

export type Match = { readonly score: number; readonly runs: readonly Range[] };

/** A separator of words: white space and `- _ . / : · › ( ) [ ]`. */
const SEPARATOR = /[\s\-_./:·›()[\]]/;
const LETTER = /[A-Za-z]/;

const isSeparator = (character: string): boolean => SEPARATOR.test(character);

/**
 * The text in lower case, as long as the text. `toLowerCase` can make a character two (`İ`), and a range found in the lower-cased text would then point past the character it names in
 * the text the row draws; such a text is folded one code unit at a time and a unit that would grow is left as it is.
 */
function fold(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) {
    return lower;
  }

  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charAt(index);
    const small = unit.toLowerCase();
    out += small.length === 1 ? small : unit;
  }

  return out;
}

/** The words of a query: lower case, split on white space, at most `LIMITS.words`: the rest never narrow a search. */
export function wordsOf(query: string): string[] {
  const words: string[] = [];
  for (const word of query.trim().split(/\s+/)) {
    if (word !== '') {
      words.push(fold(word));
      if (words.length === LIMITS.words) {
        break;
      }
    }
  }

  return words;
}

/** Where a word of a text starts: the first character, one after a separator, or a capital after a lower-case letter. */
function boundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = text.charAt(index - 1);
  if (isSeparator(previous)) {
    return true;
  }

  const current = text.charAt(index);
  return previous === previous.toLowerCase() && current !== current.toLowerCase() && LETTER.test(previous);
}

export function mergeRuns(runs: readonly Range[]): Range[] {
  const sorted = [...runs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out.at(-1);
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
  }

  return out;
}

/** The letters of `word`, in order, inside `lower[from, to)`; the window may be no wider than twice the word plus two, so a long word never strings far-apart letters together. */
function lettersIn(word: string, text: string, lower: string, from: number, to: number): Match | undefined {
  let found = 0;
  let end = -1;
  for (let index = from; index < to && found < word.length; index += 1) {
    if (lower.charAt(index) === word.charAt(found)) {
      found += 1;
      end = index;
    }
  }

  if (found < word.length) {
    return undefined;
  }

  // The tightest window that ends where the first pass ended: walk back from there.
  const at: number[] = [];
  for (let index = end, left = word.length - 1; index >= from && left >= 0; index -= 1) {
    if (lower.charAt(index) === word.charAt(left)) {
      at.push(index);
      left -= 1;
    }
  }

  at.reverse();
  const first = at[0] ?? 0;
  const span = (at.at(-1) ?? 0) - first + 1;
  if (span > word.length * 2 + 2) {
    return undefined;
  }

  const bonus = Math.min(12, at.filter((index) => boundary(text, index)).length * 3);
  return { score: 24 + Math.min(18, Math.round((18 * word.length) / span)) + bonus, runs: at.map((index): Range => [index, index + 1]) };
}

/** The first letters of consecutive words of the text: "ei" is the E of EC2 and the I of Instances. */
function initialsOf(word: string, text: string, lower: string): Match | undefined {
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (boundary(text, index) && !isSeparator(text.charAt(index))) {
      starts.push(index);
    }
  }

  for (let from = 0; from + word.length <= starts.length; from += 1) {
    let all = true;
    for (let k = 0; k < word.length; k += 1) {
      if (lower.charAt(starts[from + k] ?? -1) !== word.charAt(k)) {
        all = false;
        break;
      }
    }

    if (all) {
      return { score: 34 + Math.min(8, word.length * 2), runs: Array.from({ length: word.length }, (_, k): Range => [starts[from + k] ?? 0, (starts[from + k] ?? 0) + 1]) };
    }
  }

  return undefined;
}

/** True when the letters of `word` come in order somewhere in `lower`: what both loose matches need, checked without making anything. */
function holdsLetters(word: string, lower: string): boolean {
  let at = 0;
  for (let index = 0; index < word.length; index += 1) {
    at = lower.indexOf(word.charAt(index), at);
    if (at < 0) {
      return false;
    }

    at += 1;
  }

  return true;
}

/** The inside of a word of the lower-cased text, one after another, as `[from, to)`. */
function* tokens(lower: string): Generator<readonly [number, number]> {
  let start = -1;
  for (let index = 0; index < lower.length; index += 1) {
    if (isSeparator(lower.charAt(index))) {
      if (start >= 0) {
        yield [start, index];
        start = -1;
      }
    } else if (start < 0) {
      start = index;
    }
  }

  if (start >= 0) {
    yield [start, lower.length];
  }
}

function matchFolded(word: string, text: string, lower: string, loose: boolean): Match | undefined {
  const at = lower.indexOf(word);
  if (at >= 0) {
    let best = at;
    if (!boundary(text, at)) {
      for (let next = lower.indexOf(word, at + 1); next >= 0; next = lower.indexOf(word, next + 1)) {
        if (boundary(text, next)) {
          best = next;
          break;
        }
      }
    }

    let score = 58;
    if (word.length === lower.length) {
      score = 100;
    } else if (best === 0) {
      score = 88;
    } else if (boundary(text, best)) {
      score = 76;
    }

    return { score, runs: [[best, best + word.length]] };
  }

  if (!loose || word.length < 2 || !holdsLetters(word, lower)) {
    return undefined;
  }

  let best: Match | undefined;
  for (const [from, to] of tokens(lower)) {
    const hit = lettersIn(word, text, lower, from, to);
    if (hit !== undefined && (best === undefined || hit.score > best.score)) {
      best = hit;
    }
  }

  return best ?? initialsOf(word, text, lower);
}

/** One word against one text: its score and the ranges it matched, or `undefined`. Only a title may match loosely: keywords and context match whole text. */
export function matchWord(word: string, text: string, loose = true): Match | undefined {
  return matchFolded(word, text, fold(text), loose);
}

export type Fields = {
  readonly title: string;
  readonly context?: string | undefined;
  readonly keywords?: string | undefined;
  /** What the context is matched by when it holds more than it should (a window's name is not matched). */
  readonly matchContext?: string | undefined;
};

/** The score of a candidate for the words of a query, or `undefined` when a word matches no field. No words: `0`, nothing to rank. */
export function scoreCandidate(words: readonly string[], fields: Fields): number | undefined {
  if (words.length === 0) {
    return 0;
  }

  const title = fields.title;
  const titleLower = fold(title);
  const context = fields.matchContext ?? fields.context ?? '';
  const keywords = fields.keywords ?? '';
  // Made at most once, and only when a word reaches them.
  let contextLower: string | undefined;
  let keywordsLower: string | undefined;
  let total = 0;
  for (const word of words) {
    let best = 0;
    const inTitle = matchFolded(word, title, titleLower, true);
    if (inTitle !== undefined) {
      best = inTitle.score * 6;
    }

    if (keywords !== '') {
      keywordsLower ??= fold(keywords);
      const inKeywords = matchFolded(word, keywords, keywordsLower, false);
      if (inKeywords !== undefined && inKeywords.score * 3 > best) {
        best = inKeywords.score * 3;
      }
    }

    if (context !== '') {
      contextLower ??= fold(context);
      const inContext = matchFolded(word, context, contextLower, false);
      if (inContext !== undefined && inContext.score > best) {
        best = inContext.score;
      }
    }

    if (best === 0) {
      return undefined;
    }

    total += best;
  }

  if (words.length > 1 && titleLower.includes(words.join(' '))) {
    total += 120;
  }

  return total;
}

/**
 * The ranges to draw, word by word: the title where it matches the word, the context for a word the title does not hold. A word that matched only a keyword is drawn nowhere: the
 * user cannot see a keyword, and a run that points at nothing is noise.
 */
export function highlight(words: readonly string[], title: string, context: string): { readonly title: Range[]; readonly context: Range[] } {
  const inTitle: Range[] = [];
  const inContext: Range[] = [];
  const titleLower = fold(title);
  const contextLower = context === '' ? '' : fold(context);
  for (const word of words) {
    const hit = matchFolded(word, title, titleLower, true);
    if (hit !== undefined) {
      inTitle.push(...hit.runs);
      continue;
    }

    const other = context === '' ? undefined : matchFolded(word, context, contextLower, false);
    if (other !== undefined) {
      inContext.push(...other.runs);
    }
  }

  return { title: mergeRuns(inTitle), context: mergeRuns(inContext) };
}

/** A text cut at its ranges: what a view draws, the matched parts in weight 600. Ranges that run past the text are clipped; empty ones are dropped. */
export function partsOf(text: string, ranges: readonly Range[]): LabelPart[] {
  const clipped: Range[] = [];
  for (const [start, end] of ranges) {
    const from = Math.max(0, start);
    const to = Math.min(text.length, end);
    if (to > from) {
      clipped.push([from, to]);
    }
  }

  const parts: LabelPart[] = [];
  let at = 0;
  for (const [start, end] of mergeRuns(clipped)) {
    if (start > at) {
      parts.push({ text: text.slice(at, start), match: false });
    }

    parts.push({ text: text.slice(start, end), match: true });
    at = end;
  }

  if (at < text.length) {
    parts.push({ text: text.slice(at), match: false });
  }

  return parts;
}
