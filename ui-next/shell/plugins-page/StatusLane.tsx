import { Icon, type IconName } from '@omniviewdev/kit';
import type { State } from './core/types';
import styles from './StatusLane.module.css';

// The status lane of a plugin's detail (ch16 S133, S135): one reserved box, 80 px at least, that says the plugin's state in the host's words (a headline and a sentence) and never adds or removes height. It has the mock's two looks. The QUIET
// lane (the inline fill, muted words, no edge and no glyph) is for a plugin that runs, for one that is on its way (starting, starting again, stopping, being removed) and while this page's own work on it is under way (`working`, whatever
// the host's state is meanwhile): there is nothing to flag, and the header's progress is the one presenter of the work. A NOTICE (the fill and edge of its tone, and the glyph of its tone) is for every other state: a fault, a plugin
// running with errors, one that is off or stopped, or in a state this version does not know. The lane is a polite status: the page announces nothing by itself beyond it. Nothing a plugin wrote is in it: the model gives only the host's
// own words.

export function StatusLane({ state, working }: { readonly state: State; readonly working: boolean }) {
  const quiet = state.kind === 'running' || state.busy || working;
  // A fault and a warning have a glyph of their own; every other notice is information.
  const glyph: IconName = state.tone === 'error' ? 'status-error' : state.tone === 'warning' ? 'status-warning' : 'status-info';
  return (
    <div className={styles.lane} role="status" data-pl-part="lane" data-pl-tone={state.tone} data-pl-quiet={quiet ? 'true' : undefined}>
      {quiet ? (
        <>
          <p className={styles.line}>
            <strong>{state.title}</strong>
          </p>
          <p className={styles.line}>{state.sentence}</p>
        </>
      ) : (
        <>
          <Icon name={glyph} />
          <p className={styles.text}>
            <strong className={styles.title}>{state.title}</strong>
            {state.sentence}
          </p>
        </>
      )}
    </div>
  );
}
