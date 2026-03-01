/**
 * Single-pass ANSI SGR parser.
 *
 * Produces an array of styled text segments and a stripped plain-text string
 * in one scan. Designed for hot-path usage at log ingest (100k+ lines).
 *
 * Supported SGR codes:
 *   0        reset
 *   1        bold
 *   2        dim
 *   3        italic
 *   4        underline
 *   9        strikethrough
 *   22       normal intensity (not bold/dim)
 *   23       not italic
 *   24       not underline
 *   29       not strikethrough
 *   30-37    standard foreground
 *   38;5;N   256-color foreground
 *   38;2;R;G;B  24-bit foreground
 *   39       default foreground
 *   40-47    standard background
 *   48;5;N   256-color background
 *   48;2;R;G;B  24-bit background
 *   49       default background
 *   90-97    bright foreground
 *   100-107  bright background
 */

export interface AnsiSegment {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface ParsedAnsi {
  /** Plain text with all escape sequences removed (for search, level detection). */
  plain: string;
  /** Styled segments for rendering. Empty array if input has no ANSI codes. */
  segments: AnsiSegment[];
  /** True if the input contained any ANSI escape sequences. */
  hasAnsi: boolean;
}

// Standard 8 ANSI colors (SGR 30-37 / 40-47).
const STANDARD_COLORS = [
  '#000000', // black
  '#cc0000', // red
  '#4e9a06', // green
  '#c4a000', // yellow
  '#3465a4', // blue
  '#75507b', // magenta
  '#06989a', // cyan
  '#d3d7cf', // white
] as const;

// Bright 8 ANSI colors (SGR 90-97 / 100-107).
const BRIGHT_COLORS = [
  '#555753', // bright black (gray)
  '#ef2929', // bright red
  '#8ae234', // bright green
  '#fce94f', // bright yellow
  '#729fcf', // bright blue
  '#ad7fa8', // bright magenta
  '#34e2e2', // bright cyan
  '#eeeeec', // bright white
] as const;

// 6×6×6 color cube (indices 16-231 of 256-color palette).
// Pre-computed for zero allocation at parse time.
const COLOR_CUBE: string[] = new Array(216);
for (let r = 0; r < 6; r++) {
  for (let g = 0; g < 6; g++) {
    for (let b = 0; b < 6; b++) {
      const ri = r ? r * 40 + 55 : 0;
      const gi = g ? g * 40 + 55 : 0;
      const bi = b ? b * 40 + 55 : 0;
      COLOR_CUBE[r * 36 + g * 6 + b] = `#${hex(ri)}${hex(gi)}${hex(bi)}`;
    }
  }
}

// Grayscale ramp (indices 232-255 of 256-color palette).
const GRAYSCALE: string[] = new Array(24);
for (let i = 0; i < 24; i++) {
  const v = i * 10 + 8;
  GRAYSCALE[i] = `#${hex(v)}${hex(v)}${hex(v)}`;
}

function hex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Resolve a 256-color palette index to a CSS hex color. */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 8) return STANDARD_COLORS[n];
  if (n < 16) return BRIGHT_COLORS[n - 8];
  if (n < 232) return COLOR_CUBE[n - 16];
  return GRAYSCALE[n - 232];
}

interface Style {
  fg: string | undefined;
  bg: string | undefined;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

function resetStyle(): Style {
  return { fg: undefined, bg: undefined, bold: false, dim: false, italic: false, underline: false, strikethrough: false };
}

function toSegment(text: string, style: Style): AnsiSegment {
  const seg: AnsiSegment = { text };
  if (style.fg) seg.fg = style.fg;
  if (style.bg) seg.bg = style.bg;
  if (style.bold) seg.bold = true;
  if (style.dim) seg.dim = true;
  if (style.italic) seg.italic = true;
  if (style.underline) seg.underline = true;
  if (style.strikethrough) seg.strikethrough = true;
  return seg;
}

/**
 * Apply an array of SGR parameter numbers to the current style (mutates `style`).
 */
function applySgr(params: number[], style: Style): void {
  let i = 0;
  while (i < params.length) {
    const code = params[i];
    switch (code) {
      case 0: // reset
        style.fg = undefined;
        style.bg = undefined;
        style.bold = false;
        style.dim = false;
        style.italic = false;
        style.underline = false;
        style.strikethrough = false;
        break;
      case 1: style.bold = true; break;
      case 2: style.dim = true; break;
      case 3: style.italic = true; break;
      case 4: style.underline = true; break;
      case 9: style.strikethrough = true; break;
      case 22: style.bold = false; style.dim = false; break;
      case 23: style.italic = false; break;
      case 24: style.underline = false; break;
      case 29: style.strikethrough = false; break;
      case 39: style.fg = undefined; break;
      case 49: style.bg = undefined; break;
      default:
        // Standard foreground: 30-37
        if (code >= 30 && code <= 37) {
          style.fg = STANDARD_COLORS[code - 30];
        }
        // Standard background: 40-47
        else if (code >= 40 && code <= 47) {
          style.bg = STANDARD_COLORS[code - 40];
        }
        // Bright foreground: 90-97
        else if (code >= 90 && code <= 97) {
          style.fg = BRIGHT_COLORS[code - 90];
        }
        // Bright background: 100-107
        else if (code >= 100 && code <= 107) {
          style.bg = BRIGHT_COLORS[code - 100];
        }
        // Extended foreground: 38;5;N or 38;2;R;G;B
        else if (code === 38 && i + 1 < params.length) {
          if (params[i + 1] === 5 && i + 2 < params.length) {
            style.fg = color256(params[i + 2]);
            i += 2;
          } else if (params[i + 1] === 2 && i + 4 < params.length) {
            style.fg = `#${hex(params[i + 2] & 0xff)}${hex(params[i + 3] & 0xff)}${hex(params[i + 4] & 0xff)}`;
            i += 4;
          }
        }
        // Extended background: 48;5;N or 48;2;R;G;B
        else if (code === 48 && i + 1 < params.length) {
          if (params[i + 1] === 5 && i + 2 < params.length) {
            style.bg = color256(params[i + 2]);
            i += 2;
          } else if (params[i + 1] === 2 && i + 4 < params.length) {
            style.bg = `#${hex(params[i + 2] & 0xff)}${hex(params[i + 3] & 0xff)}${hex(params[i + 4] & 0xff)}`;
            i += 4;
          }
        }
        break;
    }
    i++;
  }
}

/**
 * Parse a string containing ANSI escape sequences into styled segments.
 *
 * Single-pass, zero-regex implementation for maximum throughput.
 * Returns both the styled segments and the plain (stripped) text.
 */
export function parseAnsi(input: string): ParsedAnsi {
  const len = input.length;

  // Fast path: no ESC byte at all → return as-is, zero allocation beyond the result.
  if (input.indexOf('\x1b') === -1) {
    return { plain: input, segments: [], hasAnsi: false };
  }

  const segments: AnsiSegment[] = [];
  const plainParts: string[] = [];
  let style = resetStyle();
  let textStart = 0;
  let i = 0;

  while (i < len) {
    if (input.charCodeAt(i) === 0x1b /* ESC */) {
      // Flush text accumulated before this escape.
      if (i > textStart) {
        const text = input.substring(textStart, i);
        segments.push(toSegment(text, style));
        plainParts.push(text);
      }

      // Check for CSI sequence: ESC [
      if (i + 1 < len && input.charCodeAt(i + 1) === 0x5b /* [ */) {
        // Parse CSI parameters.
        let j = i + 2;
        while (j < len) {
          const c = input.charCodeAt(j);
          // Parameter bytes: 0x30-0x3f  (digits 0-9, semicolon, etc.)
          if (c >= 0x30 && c <= 0x3f) { j++; continue; }
          // Intermediate bytes: 0x20-0x2f
          if (c >= 0x20 && c <= 0x2f) { j++; continue; }
          // Final byte: 0x40-0x7e
          break;
        }

        if (j < len) {
          const finalByte = input.charCodeAt(j);
          // Only process SGR ('m' = 0x6d) sequences for styling.
          if (finalByte === 0x6d) {
            const paramStr = input.substring(i + 2, j);
            if (paramStr === '' || paramStr === '0') {
              // Common case: bare ESC[m or ESC[0m → full reset.
              style = resetStyle();
            } else {
              const params = paramStr.split(';').map(s => (s === '' ? 0 : parseInt(s, 10)));
              applySgr(params, style);
            }
          }
          // Skip past the final byte regardless of whether we handled it.
          i = j + 1;
        } else {
          // Malformed: no final byte found. Skip the ESC[.
          i = j;
        }
        textStart = i;
        continue;
      }

      // OSC sequence: ESC ]  ... BEL or ST
      if (i + 1 < len && input.charCodeAt(i + 1) === 0x5d /* ] */) {
        let j = i + 2;
        while (j < len) {
          // BEL (0x07) terminates OSC
          if (input.charCodeAt(j) === 0x07) { j++; break; }
          // ST (ESC \) terminates OSC
          if (input.charCodeAt(j) === 0x1b && j + 1 < len && input.charCodeAt(j + 1) === 0x5c) { j += 2; break; }
          j++;
        }
        i = j;
        textStart = i;
        continue;
      }

      // Charset designation: ESC ( <char> or ESC ) <char> — 3 bytes total.
      if (i + 2 < len && (input.charCodeAt(i + 1) === 0x28 || input.charCodeAt(i + 1) === 0x29)) {
        i += 3;
        textStart = i;
        continue;
      }

      // Other two-byte escape (ESC + single char): skip both.
      i += 2;
      textStart = i;
      continue;
    }

    i++;
  }

  // Flush remaining text.
  if (textStart < len) {
    const text = input.substring(textStart);
    segments.push(toSegment(text, style));
    plainParts.push(text);
  }

  // Optimization: if all segments have default style, collapse to hasAnsi=true
  // but return empty segments to signal the caller can use plain text directly.
  let allDefault = true;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    if (seg.fg || seg.bg || seg.bold || seg.dim || seg.italic || seg.underline || seg.strikethrough) {
      allDefault = false;
      break;
    }
  }

  const plain = plainParts.join('');

  if (allDefault) {
    return { plain, segments: [], hasAnsi: true };
  }

  // Merge consecutive segments with identical styles to minimize span count.
  const merged: AnsiSegment[] = [segments[0]];
  for (let s = 1; s < segments.length; s++) {
    const prev = merged[merged.length - 1];
    const curr = segments[s];
    if (prev.fg === curr.fg && prev.bg === curr.bg && prev.bold === curr.bold
      && prev.dim === curr.dim && prev.italic === curr.italic
      && prev.underline === curr.underline && prev.strikethrough === curr.strikethrough) {
      // Merge by concatenating text.
      merged[merged.length - 1] = { ...prev, text: prev.text + curr.text };
    } else {
      merged.push(curr);
    }
  }

  return { plain, segments: merged, hasAnsi: true };
}
