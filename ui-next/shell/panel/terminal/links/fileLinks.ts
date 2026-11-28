// The file-link matcher (#696 step 2): which `file[:line[:col]]` candidates a line of terminal text holds. A pure module: no emulator, no I/O, no file system. Whether a candidate names a file is Go's answer (`ResolveLink`,
// step 3); this module only reads the text.
//
// One forward scan, no backtracking. A regular expression over a long dotted line froze Zed (zed#44510), and VS Code gave up `\` in paths after a catastrophic backtrack (vscode#24795). Here every character is looked at a
// bounded number of times: the scan moves forward only, a suffix is read by a hand-written reader that looks at most a few dozen characters ahead, and a path that was looked at once is consumed with its suffix. `onStep`
// reports each look so a test can count them (`fileLinks.test.ts`: steps in proportion to the length, not milliseconds).
//
// The suffix forms are VS Code's (`terminalLinkParsing.ts`, MIT; this is not its code): `:12`, `:12:3`, `:12:3-9`, `:12:3-14.9`, `:12.3`, ` 12`, ` 12:3`, `#12`, `#12:3`, `, 12`, `",12`, `", line 12`, `", line 12, col 3`,
// `" on line 12`, `", lines 12-14, characters 3-9`, `(12)`, `(12,3)`, `(12:3)`, `[12,3]`, `: (12, 3)`, plus `#L12`, `#L12-L14` and `#L12C3` (a forge's anchors).

/** The caps of the issue. A line over `maxLineLength` has no file links; a path over `maxPathLength` is never resolved; a link (the path and its suffix) over `maxLinkLength` is ignored; a line gives at most `maxLinks`. */
export type FileLinkLimits = {
  readonly maxLineLength: number;
  readonly maxLinks: number;
  readonly maxPathLength: number;
  readonly maxLinkLength: number;
};

export const FILE_LINK_LIMITS: FileLinkLimits = Object.freeze({ maxLineLength: 2000, maxLinks: 10, maxPathLength: 1024, maxLinkLength: 500 });

/**
 * One candidate. `start` and `end` are UTF-16 offsets into the text that was given (`end` is excluded) and cover the path and its suffix, not an opening quote or bracket. **The matcher knows no cells**: it does not know
 * the emulator's widths (xterm's Unicode 11 tables give a different width than any table kept here: `✅` is 2, an Arabic mark is 0), nor a wrapped row's padding cell. The link provider (step 4) gives the text of the
 * logical line (the wrapped rows joined, cut at `maxLineLength`) and maps an offset to a buffer cell through the buffer itself, one entry for each UTF-16 offset (`fileLinksXterm.test.ts` holds that mapping over a real
 * xterm, wrapped rows and padding included).
 *
 * `path` is the text as printed: no normalisation, no expansion of `~`, not resolved against any directory; only a `file:///` path is percent-decoded. `line` and `col` are as printed (a first line is 1; a printed 0 is 0).
 * `diffPrefix` is the `a/`, `b/` (or another git mnemonic) that was cut off the path of a diff header, so that a resolver can try the path with it as well.
 */
export type FileLinkCandidate = {
  readonly start: number;
  readonly end: number;
  readonly path: string;
  readonly line?: number;
  readonly col?: number;
  readonly lineEnd?: number;
  readonly colEnd?: number;
  readonly diffPrefix?: string;
};

export type FindFileLinksOptions = {
  /** Caps to change (a test lifts them; the page never does). */
  readonly limits?: Partial<FileLinkLimits>;
  /** Called once for every character the scan looks at: the step counter of the no-backtracking proof. */
  readonly onStep?: () => void;
};

const MAX_DIGITS = 9;

type Suffix = {
  readonly end: number;
  readonly line: number;
  readonly col?: number;
  readonly lineEnd?: number;
  readonly colEnd?: number;
  /** The suffix names a line without doubt: a colon and a number, or a quote that closed a path. Any word may precede it. Others need a path that has a dot or a slash, or `version 12` is a link. */
  readonly strong: boolean;
  /** The column was written after a dot (`:12.5`), which is also how an image tag reads (`nginx:1.25`). */
  readonly dotCol?: boolean;
};

type Raw = {
  start: number;
  end: number;
  path: string;
  line?: number;
  col?: number;
  lineEnd?: number;
  colEnd?: number;
  diffPrefix?: string;
};

type Quoted = {
  readonly open: number;
  readonly from: number;
  readonly to: number;
  readonly suffix: Suffix;
};

/**
 * The shapes that read as `name:number` and are not a file: a version (`v1.2.3:4`, `go1.22.1:5`), a time stamp (`2026-11-28T12:30:45`), an IPv6 address (`fe80::1`), and an image tag (`nginx:1.25`,
 * `ghcr.io/org/app:1.2`: a column after a dot, on a last name that has no dot). Each costs a pass over a path of at most 1,024 characters that the caller has already stepped over.
 */
function notAFile(path: string, suffix: Suffix): boolean {
  if (VERSION.test(path) || ISO_TIME.test(path) || (IPV6.test(path) && path.includes(':'))) {
    return true;
  }

  return suffix.dotCol === true && !path.slice(path.lastIndexOf('/') + 1).includes('.');
}

const noop = (): void => undefined;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isSpace = (c: number): boolean => c === 32 || c === 0xa0;
/** A character a path must have at least one of: a letter, an underscore or any non-ASCII character. `]`, `-1` and `::` are no file. */
const isWordChar = (c: number): boolean => isAlpha(c) || c === 95 || c >= 0x80;
const VERSION = /^(?:v|go)?\d+(?:\.\d+)+$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT/;
const IPV6 = /^[0-9a-fA-F:.]+$/;
const RATE = /^\d[\d.]*[A-Za-z]+$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

/** The text of a `file:///` path with its percent escapes decoded; `null` when a decoded character is a control or a format character (an `%1b` or `%0a` in a path is an attack, not a name). An escape that does not decode is left. */
function decodeFilePath(path: string): string | null {
  if (!path.includes('%')) {
    return path;
  }

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // not valid UTF-8 escapes: the text as printed
  }

  return CONTROL.test(decoded) ? null : decoded;
}

const isQuote = (c: number): boolean => c === 34 || c === 39 || c === 96 || c === 0x201c || c === 0x201d;

/**
 * Whether a UTF-16 unit ends a word: white space, a control character (ESC and a newline among them), the characters a path cannot hold (`<`, `>`, `|`), the box-drawing and block characters that tools draw trees
 * and tables with, and the zero-width and bidirectional format characters, with which a path reads differently from what it is.
 */
function isBreak(c: number): boolean {
  if (c <= 0x20) {
    return true;
  }

  if (c < 0x7f) {
    return c === 0x3c || c === 0x3e || c === 0x7c;
  }

  return (
    c <= 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200f) ||
    (c >= 0x2028 && c <= 0x202f) ||
    (c >= 0x2060 && c <= 0x206f) ||
    c === 0x3000 ||
    c === 0xfeff ||
    (c >= 0x2500 && c <= 0x259f)
  );
}

/** Characters that start no path: quotes and separators left from the text before. */
const isLead = (c: number): boolean => isQuote(c) || c === 58 || c === 59 || c === 44;

/** Characters a path with no suffix cannot hold (VS Code's excluded set): they end the piece. A piece is a bare path, which needs a slash. */
function endsPiece(c: number): boolean {
  switch (c) {
    case 33: // !
    case 34: // "
    case 0x201c:
    case 0x201d:
    case 38: // &
    case 39: // '
    case 40: // (
    case 41: // )
    case 42: // *
    case 58: // :
    case 59: // ;
    case 63: // ?
    case 92: // \
    case 96: // `
      return true;
    default:
      return false;
  }
}

/** Characters at which a suffix may start; a path that has none of them before its end is read when its word ends. */
function startsSuffix(c: number): boolean {
  switch (c) {
    case 34: // "
    case 0x201d:
    case 35: // #
    case 39: // '
    case 40: // (
    case 44: // ,
    case 58: // :
    case 91: // [
    case 96: // `
      return true;
    default:
      return false;
  }
}

const GIT_DIFF_PREFIX = /^[abciow12]\//;

class Matcher {
  private readonly t: string;
  private readonly n: number;
  private readonly limits: FileLinkLimits;
  private readonly step: () => void;
  private readonly out: Raw[] = [];
  /** 0: no diff header on the line; 1: `--- ` or `+++ `, the name is at offset 4; 2: `diff --git `, every name has its prefix. */
  private readonly diff: 0 | 1 | 2;
  /** Bare paths found before a suffix that may take them in: they are kept when the word ends without one. */
  private pending: Raw[] = [];
  /** The word being read is the path of a `file:///` url: its percent escapes are decoded. */
  private fileUrl = false;

  constructor(text: string, limits: FileLinkLimits, step: () => void) {
    this.t = text;
    this.n = text.length;
    this.limits = limits;
    this.step = step;
    this.diff = text.startsWith('diff --git ') ? 2 : text.startsWith('--- ') || text.startsWith('+++ ') ? 1 : 0;
  }

  run(): Raw[] {
    const { n, limits } = this;
    if (n > limits.maxLineLength) {
      return this.out;
    }

    const quoted = this.findQuoted();
    let qi = 0;
    let i = 0;
    while (i < n && this.out.length < limits.maxLinks) {
      this.step();
      if (isBreak(this.t.charCodeAt(i))) {
        i += 1;
        continue;
      }

      while (qi < quoted.length && quoted[qi].open < i) {
        qi += 1;
      }

      if (qi < quoted.length && quoted[qi].open === i) {
        this.take(quoted[qi].from, quoted[qi].to, this.t.slice(quoted[qi].from, quoted[qi].to), quoted[qi].suffix);
        i = quoted[qi].suffix.end;
        qi += 1;
        continue;
      }

      const limit = qi < quoted.length ? quoted[qi].open : n;
      let e = i;
      while (e < limit && !isBreak(this.t.charCodeAt(e))) {
        e += 1;
        this.step();
      }

      i = this.segment(i, e);
    }

    return this.out;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // Quoted names with spaces: `"my file.txt", line 3`. One pass pairs the quotes of each kind in turn (a break between two quotes needs no reset: `spacedName` refuses a name that holds one); a closing quote that no suffix follows opens the next pair, so an apostrophe in prose pairs with nothing.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  private findQuoted(): Quoted[] {
    const { t, n, limits } = this;
    const found: Quoted[] = [];
    const open = [-1, -1, -1, -1];
    let i = 0;
    while (i < n && found.length < limits.maxLinks) {
      this.step();
      const c = t.charCodeAt(i);
      const kind = c === 34 ? 0 : c === 39 ? 1 : c === 96 ? 2 : c === 0x201c || c === 0x201d ? 3 : -1;
      if (kind >= 0) {
        const from = open[kind];
        if (from < 0) {
          open[kind] = i;
        } else {
          const suffix = from + 1 < i ? this.parseSuffix(i) : null;
          if (suffix !== null && this.spacedName(from + 1, i)) {
            found.push({ open: from, from: from + 1, to: i, suffix });
            open.fill(-1);
            i = suffix.end;
            continue;
          }

          open[kind] = suffix !== null ? -1 : i;
        }
      }

      i += 1;
    }

    return found;
  }

  /** Whether `t[from, to)` is a name that holds a space, which the word scan cannot give: no end of word but a space inside, none at either end, and no url. A name with no space is the word scan's. */
  private spacedName(from: number, to: number): boolean {
    const { t } = this;
    if (isSpace(t.charCodeAt(from)) || isSpace(t.charCodeAt(to - 1))) {
      return false;
    }

    let spaced = false;
    for (let i = from; i < to; i += 1) {
      this.step();
      const c = t.charCodeAt(i);
      if (isSpace(c)) {
        spaced = true;
      } else if (isBreak(c)) {
        return false;
      } else if (c === 58 && t.charCodeAt(i + 1) === 47 && t.charCodeAt(i + 2) === 47) {
        return false;
      }
    }

    return spaced;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // The words: the scan of one run of characters that end at white space (or at the start of a quoted name).
  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Scans `t[s, e)`, a word, and returns where the scan goes on: `e`, or the end of a suffix that reached past it (` line 12`). */
  private segment(s: number, e: number): number {
    const { t, n, limits } = this;
    this.fileUrl = false;
    let ps = this.skipLead(s, e);
    let ps2 = ps;
    const opens: number[] = [];
    this.pending = [];
    let i = ps;
    while (i < e) {
      this.step();
      const c = t.charCodeAt(i);
      if (c === 58 && t.charCodeAt(i + 1) === 47 && t.charCodeAt(i + 2) === 47) {
        // `scheme://`: a url, which no path is taken from, except a `file:///` of this machine.
        const scheme = this.schemeStart(i - 1, ps);
        if (scheme >= 0) {
          if (i - scheme === 4 && t.slice(scheme, i).toLowerCase() === 'file' && t.charCodeAt(i + 3) === 47) {
            this.fileUrl = true;
            ps = i + 3;
            ps2 = ps;
            opens.length = 0;
            this.pending = [];
            i = ps;
            continue;
          }

          this.pending = [];
          return e;
        }
      }

      if (i > ps && startsSuffix(c)) {
        const suffix = this.parseSuffix(i);
        if (suffix !== null) {
          const pathStart = opens.length > 0 ? opens[opens.length - 1] + 1 : ps;
          // A suffix that is read inside a word is consumed whether or not it gives a candidate: the path before it is not read again from its start, which is what keeps a long word linear.
          this.take(pathStart, i, t.slice(pathStart, i), suffix);
          if (this.out.length >= limits.maxLinks) {
            return n;
          }

          if (suffix.end >= e) {
            return suffix.end;
          }

          ps = this.skipLead(suffix.end, e);
          ps2 = ps;
          opens.length = 0;
          i = ps;
          continue;
        }
      }

      if (isQuote(c) && i > ps) {
        // A quote that no suffix follows ends what came before it and starts a new path: `{"caller":"app/main.go:42"}` holds `app/main.go`, not everything from the first quote.
        this.piece(ps2, i);
        ps = this.skipLead(i + 1, e);
        ps2 = ps;
        opens.length = 0;
        i = ps;
        continue;
      }

      if (c === 40 || c === 91) {
        opens.push(i);
      } else if (c === 41 || c === 93) {
        opens.pop();
      }

      if (endsPiece(c)) {
        this.piece(ps2, i);
        ps2 = i + 1;
      } else if (i === ps2 && (c === 91 || c === 93 || c === 123 || c === 125)) {
        ps2 = i + 1;
      }

      i += 1;
    }

    if (e < n && e > ps) {
      const suffix = this.parseSuffix(e);
      if (suffix !== null) {
        const pathStart = opens.length > 0 ? opens[opens.length - 1] + 1 : ps;
        // At the end of the word a suffix that gives no candidate is not consumed (`at 2026-11-28T12:30:45Z`: the ` 2026` after `at` is no line, and the word after it is read whole): each character is read at most twice.
        if (this.take(pathStart, e, t.slice(pathStart, e), suffix)) {
          return suffix.end;
        }
      }
    }

    this.piece(ps2, e);
    this.flush();
    return e;
  }

  private skipLead(from: number, to: number): number {
    let i = from;
    while (i < to && isLead(this.t.charCodeAt(i))) {
      this.step();
      i += 1;
    }

    return i;
  }

  /** Where the url scheme that ends at `t[at]` begins, or -1: letters, digits, `+`, `-` and `.`, the first a letter, at or after `floor` and at most 32 back. */
  private schemeStart(at: number, floor: number): number {
    const { t } = this;
    const stop = Math.max(floor - 1, at - 33);
    let i = at;
    while (i > stop) {
      const c = t.charCodeAt(i);
      if (!(isAlpha(c) || isDigit(c) || c === 43 || c === 45 || c === 46)) {
        break;
      }

      this.step();
      i -= 1;
    }

    return i < at && isAlpha(t.charCodeAt(i + 1)) ? i + 1 : -1;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // Bare paths: a run of path characters with a slash in it, which has no suffix.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  private piece(from: number, to: number): void {
    const { t, limits } = this;
    const a = from;
    let b = to;

    let bracket = false;
    let slashes = 0;
    let lastSlash = -1;
    let plain = false;
    for (let i = a; i < b; i += 1) {
      this.step();
      const c = t.charCodeAt(i);
      if (c === 47) {
        slashes += 1;
        lastSlash = i;
      } else if (c === 91 || c === 123) {
        bracket = true;
      }

      if (isWordChar(c)) {
        plain = true;
      }
    }

    while (b > a) {
      const c = t.charCodeAt(b - 1);
      if (c === 46 || c === 44 || ((c === 93 || c === 125) && !bracket)) {
        b -= 1;
        this.step();
      } else {
        break;
      }
    }

    // `App.run/1` is a function and its arity (Elixir, Erlang), not a directory and a file.
    const arity = slashes === 1 && /^\d+$/.test(t.slice(lastSlash + 1, b));
    // `9.00it/s` and `5MB/s` are rates, not a directory and a file.
    const rate = slashes === 1 && RATE.test(t.slice(a, lastSlash));
    if (slashes === 0 || arity || rate || !plain || b <= a || this.pending.length + this.out.length >= limits.maxLinks) {
      return;
    }

    const raw = this.build(a, b, t.slice(a, b), null);
    if (raw !== null) {
      this.pending.push(raw);
    }
  }

  private flush(): void {
    for (const raw of this.pending) {
      if (this.out.length >= this.limits.maxLinks) {
        break;
      }

      this.out.push(raw);
    }

    this.pending = [];
  }

  /** A suffix took the text from `pathStart`: the bare paths before it stay (they end before the path), and those that it covers go. */
  private release(pathStart: number): void {
    const kept = this.pending.filter((p) => p.end <= pathStart);
    this.pending = kept;
    this.flush();
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // A candidate.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Builds a candidate, cuts a git diff prefix off a path in a diff header, and decodes a `file:///` path. `null` for a path that decodes to a control character. `suffix` is null for a bare path. */
  private build(start: number, end: number, path: string, suffix: Suffix | null): Raw | null {
    let s = start;
    let p = path;
    if (this.fileUrl) {
      const decoded = decodeFilePath(p);
      if (decoded === null) {
        return null;
      }

      p = decoded;
    }

    let diffPrefix: string | undefined;
    if (this.diff === 2 ? GIT_DIFF_PREFIX.test(p) : this.diff === 1 && start === 4 && GIT_DIFF_PREFIX.test(p)) {
      diffPrefix = p.slice(0, 2);
      p = p.slice(2);
      s += 2;
    }

    const raw: Raw = { start: s, end: suffix === null ? end : suffix.end, path: p };
    if (diffPrefix !== undefined) {
      raw.diffPrefix = diffPrefix;
    }

    if (suffix !== null) {
      raw.line = suffix.line;
      if (suffix.col !== undefined) {
        raw.col = suffix.col;
      }

      if (suffix.lineEnd !== undefined) {
        raw.lineEnd = suffix.lineEnd;
      }

      if (suffix.colEnd !== undefined) {
        raw.colEnd = suffix.colEnd;
      }
    }

    return raw;
  }

  /** Takes a path with its suffix when it is a candidate: a letter in it, a dot or a slash unless the suffix is sure, none of the shapes of `notAFile`, within the caps. True when it was taken (the bare paths that it covers are dropped first). */
  private take(start: number, pathEnd: number, path: string, suffix: Suffix): boolean {
    const { limits } = this;
    if (start >= pathEnd || this.out.length >= limits.maxLinks || path.length > limits.maxPathLength || suffix.end - start > limits.maxLinkLength) {
      return false;
    }

    let plain = false;
    let fileLike = false;
    for (let i = 0; i < path.length; i += 1) {
      this.step();
      const c = path.charCodeAt(i);
      if (isWordChar(c)) {
        plain = true;
      }

      if (c === 46 || c === 47 || c === 92) {
        fileLike = true;
      }
    }

    if (!plain || !(suffix.strong || fileLike) || notAFile(path, suffix)) {
      return false;
    }

    const raw = this.build(start, pathEnd, path, suffix);
    if (raw === null) {
      return false;
    }

    this.release(start);
    this.out.push(raw);
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // The suffix reader. Each form looks ahead a bounded number of characters: digits are read at most `MAX_DIGITS + 1` and a keyword is compared once.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Reads a suffix that starts at `p`, where the path ended. `null` when none of the forms is there. */
  private parseSuffix(p: number): Suffix | null {
    const { t, n } = this;
    let j = p;
    const quoted = isQuote(t.charCodeAt(j));
    if (quoted) {
      j += 1;
    }

    if (j >= n) {
      return null;
    }

    const c = t.charCodeAt(j);
    let found: Suffix | null = null;
    switch (c) {
      case 58: // :
        found = this.numbers(j + 1, true) ?? this.words(j + 1 + (isSpace(t.charCodeAt(j + 1)) ? 1 : 0)) ?? this.brackets(j);
        break;
      case 35: // #
        found = t.charCodeAt(j + 1) === 76 ? this.anchor(j + 2) : this.numbers(j + 1, false);
        break;
      case 44: // ,
        if (quoted) {
          found = this.numbers(j + 1, true) ?? (isSpace(t.charCodeAt(j + 1)) ? this.words(j + 2) : null);
        } else if (isSpace(t.charCodeAt(j + 1))) {
          found = this.numbers(j + 2, false) ?? this.words(j + 2);
        }

        break;
      case 32:
      case 0xa0:
        found = this.numbers(j + 1, false) ?? this.spaced(j + 1) ?? this.brackets(j);
        break;
      case 40: // (
      case 91: // [
        found = this.brackets(j);
        break;
      default:
        break;
    }

    if (found === null || !quoted) {
      return found;
    }

    return { ...found, strong: true };
  }

  /** `N`, `N:M`, `N.M`, `N:M-M2`, `N:M-N2.M2`. */
  private numbers(k: number, strong: boolean): Suffix | null {
    const line = this.digits(k);
    if (line === null) {
      return null;
    }

    let end = line.end;
    let col: number | undefined;
    let lineEnd: number | undefined;
    let colEnd: number | undefined;
    const sep = this.t.charCodeAt(end);
    if (sep === 58 || sep === 46) {
      const c = this.digits(end + 1);
      if (c !== null) {
        col = c.value;
        end = c.end;
        if (this.t.charCodeAt(end) === 45) {
          const a = this.digits(end + 1);
          if (a !== null) {
            if (this.t.charCodeAt(a.end) === 46) {
              const b = this.digits(a.end + 1);
              if (b !== null) {
                lineEnd = a.value;
                colEnd = b.value;
                end = b.end;
              } else {
                colEnd = a.value;
                end = a.end;
              }
            } else {
              colEnd = a.value;
              end = a.end;
            }
          }
        }
      }
    }

    return this.make(end, line.value, col, lineEnd, colEnd, strong, col !== undefined && sep === 46);
  }

  /** ` on ` before `line N`, or `line N` itself. */
  private spaced(k: number): Suffix | null {
    const { t } = this;
    if (t.charCodeAt(k) === 111 && t.charCodeAt(k + 1) === 110 && isSpace(t.charCodeAt(k + 2))) {
      return this.words(k + 3);
    }

    return this.words(k);
  }

  /** `line N`, `lines N-M`, then `, col M`, `, column M`, `, character M`, `, characters M-M2`; `k` is where `line` starts. */
  private words(k: number): Suffix | null {
    const { t } = this;
    if (!t.startsWith('line', k)) {
      return null;
    }

    let i = k + 4;
    if (t.charCodeAt(i) === 115) {
      i += 1;
    }

    if (!isSpace(t.charCodeAt(i))) {
      return null;
    }

    const line = this.digits(i + 1);
    if (line === null) {
      return null;
    }

    let end = line.end;
    let lineEnd: number | undefined;
    let col: number | undefined;
    let colEnd: number | undefined;
    if (t.charCodeAt(end) === 45) {
      const a = this.digits(end + 1);
      if (a !== null) {
        lineEnd = a.value;
        end = a.end;
      }
    }

    let m = end;
    if (t.charCodeAt(m) === 44) {
      m += 1;
    }

    if (isSpace(t.charCodeAt(m))) {
      m += 1;
      const word = t.startsWith('column', m) ? 6 : t.startsWith('col', m) ? 3 : t.startsWith('characters', m) ? 10 : t.startsWith('character', m) ? 9 : 0;
      if (word > 0 && isSpace(t.charCodeAt(m + word))) {
        const c = this.digits(m + word + 1);
        if (c !== null) {
          col = c.value;
          end = c.end;
          if (t.charCodeAt(end) === 45) {
            const b = this.digits(end + 1);
            if (b !== null) {
              colEnd = b.value;
              end = b.end;
            }
          }
        }
      }
    }

    return this.make(end, line.value, col, lineEnd, colEnd, false);
  }

  /** `(N)`, `(N,M)`, `(N, M)`, `(N:M)` with `()` or `[]`, after an optional `:` and an optional space; `k` is the first of them. */
  private brackets(k: number): Suffix | null {
    const { t } = this;
    let i = k;
    if (t.charCodeAt(i) === 58) {
      i += 1;
    }

    if (isSpace(t.charCodeAt(i))) {
      i += 1;
    }

    const open = t.charCodeAt(i);
    if (open !== 40 && open !== 91) {
      return null;
    }

    const line = this.digits(i + 1);
    if (line === null) {
      return null;
    }

    let end = line.end;
    let col: number | undefined;
    const sep = t.charCodeAt(end);
    if (sep === 44 || sep === 58) {
      const m = end + 1 + (sep === 44 && isSpace(t.charCodeAt(end + 1)) ? 1 : 0);
      const c = this.digits(m);
      if (c === null) {
        return null;
      }

      col = c.value;
      end = c.end;
    }

    const close = t.charCodeAt(end);
    if (close !== 41 && close !== 93) {
      return null;
    }

    return this.make(end + 1, line.value, col, undefined, undefined, false);
  }

  /** `L12`, `L12-L14`, `L12C3`, after `#`; `k` is after the `L`. */
  private anchor(k: number): Suffix | null {
    const { t } = this;
    const line = this.digits(k);
    if (line === null) {
      return null;
    }

    let end = line.end;
    let lineEnd: number | undefined;
    let col: number | undefined;
    if (t.charCodeAt(end) === 45 && t.charCodeAt(end + 1) === 76) {
      const a = this.digits(end + 2);
      if (a !== null) {
        lineEnd = a.value;
        end = a.end;
      }
    } else if (t.charCodeAt(end) === 67) {
      const c = this.digits(end + 1);
      if (c !== null) {
        col = c.value;
        end = c.end;
      }
    }

    return this.make(end, line.value, col, lineEnd, undefined, false);
  }

  private make(end: number, line: number, col: number | undefined, lineEnd: number | undefined, colEnd: number | undefined, strong: boolean, dotCol = false): Suffix {
    return {
      end,
      line,
      ...(col === undefined ? {} : { col }),
      ...(lineEnd === undefined ? {} : { lineEnd }),
      ...(colEnd === undefined ? {} : { colEnd }),
      strong,
      ...(dotCol ? { dotCol } : {}),
    };
  }

  /** One to nine digits at `k`; none when there are no digits or more than nine (a number that long is no line). */
  private digits(k: number): { value: number; end: number } | null {
    const { t } = this;
    let i = k;
    let value = 0;
    while (i < this.n && isDigit(t.charCodeAt(i))) {
      this.step();
      if (i - k >= MAX_DIGITS) {
        return null;
      }

      value = value * 10 + (t.charCodeAt(i) - 48);
      i += 1;
    }

    return i === k ? null : { value, end: i };
  }
}

export function findFileLinks(text: string, options: FindFileLinksOptions = {}): FileLinkCandidate[] {
  const limits: FileLinkLimits = { ...FILE_LINK_LIMITS, ...options.limits };
  return new Matcher(text, limits, options.onStep ?? noop).run();
}
