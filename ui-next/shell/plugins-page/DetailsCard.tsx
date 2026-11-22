import { useId } from 'react';
import { capabilityWord } from './capabilityWords';
import type { Installed } from './core/types';
import styles from './DetailsCard.module.css';

// The "Details" card of a plugin (ch16 S133, the mock's `.plug-card`): a row for each fact the host has of the plugin and none for what it lacks (a plugin with no licence has no License row). The repository and the website are plain
// selectable text, in the code face: nothing in this slice opens an address, so none is a link.

type Fact = { readonly label: string; readonly value: string; readonly mono: boolean };

/** Where the plugin came from, as far as the host says: the product's own, a development link, or an installed one. */
function sourceOf(plugin: Installed): string {
  if (plugin.builtin) {
    return 'Built into Omniview';
  }

  return plugin.devMode ? 'Linked from a source folder' : 'Installed';
}

/** The rows of the card, in the order the person reads them. */
export function factsOf(plugin: Installed): readonly Fact[] {
  const provides = [...new Set(plugin.capabilities.map(capabilityWord))].join(', ');
  const all: readonly Fact[] = [
    { label: 'Version', value: plugin.version, mono: false },
    { label: 'Publisher', value: plugin.publisher, mono: false },
    { label: 'License', value: plugin.license, mono: false },
    { label: 'Category', value: plugin.category, mono: false },
    { label: 'Source', value: sourceOf(plugin), mono: false },
    { label: 'Provides', value: provides, mono: false },
    { label: 'Channel', value: plugin.releaseChannel, mono: false },
    { label: 'Repository', value: plugin.repository, mono: true },
    { label: 'Website', value: plugin.website, mono: true },
  ];
  return all.filter((fact) => fact.value !== '');
}

export function DetailsCard({ plugin }: { readonly plugin: Installed }) {
  const heading = useId();
  return (
    <section className={styles.card} aria-labelledby={heading} data-pl-part="card">
      <h3 id={heading} className={styles.title}>
        Details
      </h3>
      <dl className={styles.list}>
        {factsOf(plugin).map((fact) => (
          <div key={fact.label} className={styles.row} data-pl-part="card-row">
            <dt className={styles.term}>{fact.label}</dt>
            <dd className={fact.mono ? styles.code : styles.value}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
