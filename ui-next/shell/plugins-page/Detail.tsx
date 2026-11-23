import { EmptyBody } from '@omniviewdev/kit';
import type { PluginsModel } from './core/model';
import styles from './Detail.module.css';
import { DetailsCard } from './DetailsCard';
import { Header } from './Header';
import { useRow } from './hooks';
import { StatusLane } from './StatusLane';

// The right pane of the Plugins page (ch16 S133): the plugin the person is reading, from its header down: the identity and its actions, the status lane, the details card. It reads one row of the model and draws it; every action is the
// model's. The pane is an island surface with 12 px inside. With no plugin chosen (or none by that id) it says so.

export type DetailProps = {
  readonly model: PluginsModel;
  /** The plugin to show, or null for none. */
  readonly id: string | null;
  /** The person asked to uninstall (or unlink) the plugin: the page confirms, and then calls the model. */
  readonly onUninstall: (id: string) => void;
};

export function Detail({ model, id, onUninstall }: DetailProps) {
  const row = useRow(model, id ?? '');

  if (id === null || row === undefined) {
    return (
      <section className={styles.pane} aria-label="Plugin details" tabIndex={-1} data-pl-part="detail">
        <div className={styles.empty} data-pl-part="detail-empty">
          <EmptyBody title="Select a plugin" hint="Choose a plugin in the list to see what it does and how it is doing." />
        </div>
      </section>
    );
  }

  return (
    <section className={styles.pane} aria-label={row.plugin.name} tabIndex={-1} data-pl-part="detail">
      <Header key={row.id} row={row} model={model} onUninstall={onUninstall} />
      <StatusLane state={row.state} working={row.op !== null} />
      <DetailsCard plugin={row.plugin} />
    </section>
  );
}
