import { Icon, tip, type IconName } from '@omniviewdev/kit';
import type { ReactNode } from 'react';
import { LIMITS, type PaletteState, type Run, type RunTone } from '../core/palette';
import styles from './Palette.module.css';

// The status band (ch16 S72): a reserved 24 px that shows only something notable, so nothing moves when a source answers late: Searching… after a second, a run for each source that did not
// answer, answered in part or was limited, each with a named Retry where retry helps, and more than three runs folded into a `+N` that shows the Sources list in place of the results.
// No Ready, no collapsed details. Kit part it should become: a link that is a button (the kit's `Link` is an anchor that opens a route).

const GLYPHS: Readonly<Record<RunTone, IconName>> = { error: 'status-error', warning: 'status-warning', info: 'status-info' };

type LinkButtonProps = {
  readonly children: string;
  readonly label?: string | undefined;
  readonly onPress: () => void;
};

/** A button drawn as a link, 16 px high with the 24 px of the band as its hit area (A20). A Tab stop, as every control is (decision A14). */
function LinkButton({ children, label, onPress }: LinkButtonProps) {
  return (
    <button
      type="button"
      className={styles.linkButton}
      aria-label={label}
      onClick={() => {
        onPress();
      }}
    >
      {children}
    </button>
  );
}

/** A state, as the band draws it: the glyph of its meaning and its words, 12/16. */
function Mark({ glyph, children }: { readonly glyph: IconName; readonly children: ReactNode }) {
  return (
    <span className={styles.mark}>
      <Icon name={glyph} />
      <span className={styles.markLabel}>{children}</span>
    </span>
  );
}

type BandProps = {
  readonly state: PaletteState;
  readonly onRetry: (source: string) => void;
  readonly onSources: () => void;
  readonly onResults: () => void;
};

export function Band({ state, onRetry, onSources, onResults }: BandProps) {
  const { runs, folded, slow, view } = state;
  return (
    <div className={styles.band} data-palette-part="band">
      {view === 'sources' ? (
        <LinkButton onPress={onResults}>Back to results</LinkButton>
      ) : (
        <>
          {slow ? (
            <span className={styles.run}>
              <Mark glyph="loader-circle">Searching…</Mark>
            </span>
          ) : null}
          {runs.slice(0, LIMITS.runs).map((run) => (
            <RunView key={run.id} run={run} onRetry={onRetry} />
          ))}
          {folded > 0 ? (
            <LinkButton label={`+${String(folded)} more, show all ${String(runs.length)} sources`} onPress={onSources}>
              {`+${String(folded)}`}
            </LinkButton>
          ) : null}
        </>
      )}
    </div>
  );
}

function RunView({ run, onRetry }: { readonly run: Run; readonly onRetry: (source: string) => void }) {
  return (
    <span className={styles.run} data-palette-part="run" {...tip(run.message)}>
      <Mark glyph={GLYPHS[run.tone]}>{run.label}</Mark>
      {run.retry ? (
        <LinkButton
          label={`Retry ${run.name}`}
          onPress={() => {
            onRetry(run.id);
          }}
        >
          Retry
        </LinkButton>
      ) : null}
    </span>
  );
}
