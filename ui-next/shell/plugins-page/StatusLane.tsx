import { Icon, type IconName } from '@omniviewdev/kit';
import type { State } from './core/types';
import styles from './StatusLane.module.css';

// The status lane of a plugin's detail (ch16 S133, S135): one reserved box, 80 px at least, that says the plugin's state in the host's words (a headline and a sentence) and never adds or removes height. A plugin that is running gets the quiet
// variant (no glyph, muted text); every other state is a notice of its tone. The lane is a polite status: the page announces nothing by itself beyond it. Nothing a plugin wrote is in it: the model gives only the host's own words.

/** The glyph of a state: work under way turns, a fault and a warning have their own, a state that is only to be told is information, and a healthy plugin has none. */
function glyphOf(state: State): IconName | undefined {
  if (state.kind === 'running') {
    return undefined;
  }

  if (state.busy) {
    return 'loader-circle';
  }

  switch (state.tone) {
    case 'error':
      return 'status-error';
    case 'warning':
      return 'status-warning';
    case 'success':
      return undefined;
    case 'neutral':
    case 'info':
      return 'status-info';
  }
}

export function StatusLane({ state }: { readonly state: State }) {
  const glyph = glyphOf(state);
  return (
    <div className={styles.lane} role="status" data-pl-part="lane" data-pl-tone={state.tone} data-pl-quiet={state.kind === 'running' ? 'true' : undefined}>
      {glyph === undefined ? null : <Icon name={glyph} data-pl-spin={state.busy ? 'true' : undefined} />}
      <p className={styles.text}>
        <strong className={styles.title}>{state.title}</strong>
        {state.sentence}
      </p>
    </div>
  );
}
