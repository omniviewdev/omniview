import { memo } from 'react';
import { formatStamp } from '../../log/time';
import { matchRanges, rowRuns, type RowRun } from '../../log/runs';
import type { SourceTag } from '../../log/sources';
import type { LogEntry, LogLevel, LogTimestamps, PaintedRun } from '../../log/types';
import { Icon, type IconName } from '../Icon';
import { MiddleEllipsis } from '../MiddleEllipsis';
import { MissingValue } from '../MissingValue';
import styles from './LogView.module.css';

/** The glyph and the word of each level (the mock's `H.status` of a log level: an outcome with a tone, DEBUG a plain circle). */
const LEVELS: Readonly<Record<LogLevel, { readonly glyph: IconName; readonly word: string }>> = {
  trace: { glyph: 'circle', word: 'TRACE' },
  debug: { glyph: 'circle', word: 'DEBUG' },
  info: { glyph: 'status-info', word: 'INFO' },
  warn: { glyph: 'status-warning', word: 'WARN' },
  error: { glyph: 'status-error', word: 'ERROR' },
};

const NUMBER = new Intl.NumberFormat('en-US');

export type LogRowProps = {
  readonly entry: LogEntry;
  /** The element id: the list's `aria-activedescendant` names it. */
  readonly id: string;
  /** The row's place in the grid, from 1 at the header: the index of the entry in the list plus 2. It is `aria-rowindex`, and it changes when the head goes. */
  readonly position: number;
  readonly selected: boolean;
  /** The row holds the current search match: its matches take the accent. */
  readonly current: boolean;
  /** The pattern to mark matches with. Given only to a line that HAS a match, so a keystroke renders those rows and no other (HLT-12). */
  readonly pattern: RegExp | undefined;
  /** The log has a source column (it has more than one source): every row has a cell for it, and a marker spans one more column. Without one a row is what it was before the column existed. */
  readonly sourceColumn: boolean;
  /** The source of the line, drawn in its cell; undefined for a line that names none. The same object for a source until its label changes, so it widens the memo's comparison without adding a render (HLT-2). */
  readonly source: SourceTag | undefined;
  /** The clock the row shows: the viewer's own, or UTC with a Z after it. A choice of the view, the same for every row, so a change draws the rows that are mounted and no other work. */
  readonly timestamps: LogTimestamps;
};

/** One piece of a row's text: bare text when it has no paint and no mark, one span when it has. */
function Run({ run }: { readonly run: RowRun | PaintedRun }) {
  const mark = 'mark' in run ? run.mark : undefined;
  if (run.hue === undefined && run.bold !== true && mark === undefined) {
    return run.text;
  }

  return (
    <span data-ov-hue={run.hue} data-ov-bold={run.bold === true ? 'true' : undefined} data-ov-mark={mark}>
      {run.text}
    </span>
  );
}

function Text({ text, runs, current, pattern }: { readonly text: string; readonly runs: readonly PaintedRun[] | undefined; readonly current: boolean; readonly pattern: RegExp | undefined }) {
  if (pattern === undefined) {
    // The common line: a string and nothing else (HLT-3).
    return runs === undefined ? text : runs.map((run, index) => <Run key={index} run={run} />);
  }

  return rowRuns(text, runs, matchRanges(text, pattern), current ? 'current' : 'found').map((run, index) => <Run key={index} run={run} />);
}

/**
 * One line of the log, or the marker where the feed dropped lines. Memoised on what it draws: the entry (immutable, made once at ingest), whether it is
 * selected or current, the pattern when it has a match, its source when the log has a source column, and the zone of the clock. A flush that appends lines renders none of the rows that
 * were already there (HLT-2, MNR-L3). A plain row is the row, three cells, the level's glyph and its text: no per-row style, no per-row handler (HLT-3, T-07); with a
 * source column it has a cell more, the source's name in a chip whose swatch takes the hue of its place in the series (the mock's `chipOf`). The clock is `HH:MM:SS.mmm` in the viewer's time, or `HH:MM:SS.mmmZ`
 * in UTC; its tip is the line's own timestamp (the source's text: the date, the zone and every digit of the fraction), an attribute the one tooltip of the window reads, so a row adds no element and no handler for it.
 */
export const LogRow = memo(function LogRow({ entry, id, position, selected, current, pattern, sourceColumn, source, timestamps }: LogRowProps) {
  if (entry.kind === 'gap') {
    return (
      <div role="row" id={id} aria-rowindex={position} aria-selected={selected ? 'true' : undefined} className={styles.marker} data-n={entry.n} data-ov-kind="gap">
        <span role="gridcell" aria-colspan={sourceColumn ? 4 : 3} className={styles.markerCell}>
          <Icon name="status-info" />
          {`${NUMBER.format(entry.dropped)} ${entry.dropped === 1 ? 'line' : 'lines'} dropped`}
        </span>
      </div>
    );
  }

  const level = entry.level === undefined ? undefined : LEVELS[entry.level];
  const clock = formatStamp(entry.timestamp, timestamps);
  return (
    <div
      role="row"
      id={id}
      aria-rowindex={position}
      aria-selected={selected ? 'true' : undefined}
      className={styles.row}
      data-n={entry.n}
      data-ov-level={entry.level}
      data-ov-current={current ? 'true' : undefined}
    >
      <span role="gridcell" className={styles.time} data-ov-tip={clock === '' ? undefined : entry.timestamp}>
        {clock}
      </span>
      <span role="gridcell" className={styles.level}>
        {level === undefined ? (
          <MissingValue name="No level" />
        ) : (
          <>
            <Icon name={level.glyph} />
            {level.word}
          </>
        )}
      </span>
      {sourceColumn ? (
        <span role="gridcell" className={styles.source}>
          {source === undefined ? null : (
            <span className={styles.chip} data-ov-hue={source.hue}>
              <MiddleEllipsis>{source.label}</MiddleEllipsis>
            </span>
          )}
        </span>
      ) : null}
      <span role="gridcell" className={styles.text}>
        <Text text={entry.text} runs={entry.runs} current={current} pattern={pattern} />
      </span>
    </div>
  );
});
