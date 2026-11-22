import { Icon } from '@omniviewdev/kit';
import { memo } from 'react';
import type { PluginsModel } from './core/model';
import { useRow } from './hooks';
import styles from './Row.module.css';
import { StateChip } from './StateChip';

// One plugin's row of the Installed list (ch16 S133, S135): the tile, the name and the version, then one line that starts with the state word (never colour alone) and goes on with the publisher and the description. A
// plugin that failed says the host's sentence for it on that line instead, so the reason is read without opening the detail. The row is ONE native button: the whole row is the target, Enter and Space choose it as a click does,
// and the roving group the list holds around it makes the rows one Tab stop. It reads only its own row (`useRow`), and it is memoised on the three things it is given, so what happens to one plugin renders that
// plugin's row and nothing else of the list.

type RowProps = {
  readonly model: PluginsModel;
  readonly id: string;
  /** Whether this is the plugin whose detail is shown. */
  readonly selected: boolean;
};

export const Row = memo(function Row({ model, id, selected }: RowProps) {
  const row = useRow(model, id);
  if (row === undefined) {
    return null;
  }

  const { plugin, state, tile, op } = row;
  const isFailed = state.kind === 'failed' || state.faulted;
  const isBusy = op !== null || state.busy;
  // A manifest may leave either out; what is there is said, joined by the separator the line uses.
  const summary = [plugin.publisher, plugin.description].filter((part) => part !== '').join(' · ');

  return (
    <button
      type="button"
      className={styles.row}
      aria-current={selected ? 'true' : undefined}
      aria-busy={isBusy ? 'true' : undefined}
      data-pl-part="row"
      data-pl-id={id}
      data-pl-selected={selected ? 'true' : 'false'}
      data-pl-state={state.kind}
      onClick={() => {
        model.select(id);
      }}
    >
      <span className={styles.tile} data-accent={tile.accent} data-pl-part="row-tile" aria-hidden="true">
        <Icon name={tile.icon} />
      </span>
      <span className={styles.text}>
        <span className={styles.first} data-ov-clip="">
          <span className={styles.name} data-pl-part="row-name">
            {plugin.name}
          </span>
          {plugin.version === '' ? null : (
            <>
              {' '}
              <span className={styles.version} data-pl-part="row-version">
                {plugin.version}
              </span>
            </>
          )}
        </span>
        {/* The lines are blocks to the eye and run together to a name made of text alone, so a space stands between them (a flex container draws none). */}
        {' '}
        <span className={styles.second} data-pl-part="row-line2">
          {state.word === '' ? null : (
            <span className={styles.chip} data-pl-part="row-chip">
              <StateChip state={state} />
            </span>
          )}
          {' '}
          <span className={styles.clip} data-ov-clip="" data-pl-part={isFailed ? 'row-sentence' : undefined}>
            {isFailed ? state.sentence : summary}
          </span>
        </span>
      </span>
    </button>
  );
});
