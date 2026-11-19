// The paint of a log line: the closed set of hues the design allows (the mock's `.plog__a[data-hue]`) and bold. The carried parser (parseAnsi.ts,
// HLT-14) reads every SGR code and gives hex colours; the design paints none of them as hex, because a hex is no theme's colour: red is the theme's error
// colour, green its success colour, and so on, in every one of the nine themes. So this maps what the parser read, once per line at ingest, to a hue or
// to nothing: black and white keep the default colour, and so does a colour of the 256 or 24-bit palettes (the mock ignores them too), and a background,
// italic, underline, dim and strike-through are not painted. A 256 or 24-bit foreground keeps the default colour even when it resolves to the very hex of one of
// the 16 (38;5;1 and 38;2;204;0;0 are #cc0000, as 31 is), so the map is read only for a foreground the parser did not mark `fgExtended`: the standard and bright
// codes.
import { BRIGHT_COLORS, STANDARD_COLORS, type AnsiSegment } from './parseAnsi';
import type { LogHue, PaintedRun } from './types';

/** The hue of each of the 16 colours the parser names, by the colour it resolves them to; black and white are absent. */
const HUES = new Map<string, LogHue>([
  [STANDARD_COLORS[1], 'red'],
  [STANDARD_COLORS[2], 'green'],
  [STANDARD_COLORS[3], 'amber'],
  [STANDARD_COLORS[4], 'blue'],
  [STANDARD_COLORS[5], 'purple'],
  [STANDARD_COLORS[6], 'cyan'],
  [BRIGHT_COLORS[0], 'gray'],
  [BRIGHT_COLORS[1], 'red'],
  [BRIGHT_COLORS[2], 'green'],
  [BRIGHT_COLORS[3], 'amber'],
  [BRIGHT_COLORS[4], 'blue'],
  [BRIGHT_COLORS[5], 'purple'],
  [BRIGHT_COLORS[6], 'cyan'],
]);

/**
 * The hue of a colour the parser resolved, or undefined when the design leaves the line's own colour alone. It knows hex, not how the colour was written:
 * `paintedRuns` reads it for the standard and bright foregrounds only.
 */
export function hueOfColor(color: string | undefined): LogHue | undefined {
  return color === undefined ? undefined : HUES.get(color);
}

/**
 * The painted runs of a line from its parsed segments, or undefined when no run is painted (the common case, so a plain string renders). The runs
 * cover the whole text: a stretch between two painted ones is a run with no paint. Neighbours that came out alike are one run.
 */
export function paintedRuns(segments: readonly AnsiSegment[]): readonly PaintedRun[] | undefined {
  let painted = false;
  const runs: PaintedRun[] = [];
  for (const segment of segments) {
    // A 256 or 24-bit foreground has no hue, whatever hex it resolved to: only SGR 30-37 and 90-97 are the 16 colours the design paints.
    const hue = segment.fgExtended === true ? undefined : hueOfColor(segment.fg);
    const bold = segment.bold === true;
    const last = runs.at(-1);
    if (last !== undefined && last.hue === hue && (last.bold === true) === bold) {
      runs[runs.length - 1] = { ...last, text: last.text + segment.text };
      continue;
    }

    painted ||= hue !== undefined || bold;
    runs.push({ text: segment.text, ...(hue === undefined ? {} : { hue }), ...(bold ? { bold: true } : {}) });
  }

  return painted ? runs : undefined;
}
