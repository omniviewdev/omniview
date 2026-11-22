import { CollectionFooter, EmptyBody, ErrorBody, LoadingBody, RovingGroup, Text } from '@omniviewdev/kit';
import type { ReactNode } from 'react';
import type { PluginsModel } from './core/model';
import { useList } from './hooks';
import styles from './List.module.css';
import { Row } from './Row';

// The left pane of the Plugins page (ch16 S133): the installed plugins, one row each, in the order the model gives. The list reads the model's snapshot (its status, its plugins and the one selected); each row reads its own
// plugin (`Row`), so a state event on one plugin renders that row and not this list. The rows are one Tab stop in the kit's roving group: the arrows, Home and End move the focus and select nothing, Enter and Space choose,
// and the selected row holds the stop. What the first slice does not have is not drawn: no search, no filter, no sort, no switch on the row.

export function List({ model }: { readonly model: PluginsModel }) {
  const { status, ids, selected } = useList(model);
  const count = ids.length;

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <div data-pl-part="list-loading">
        <LoadingBody label="installed plugins" columns={2} />
      </div>
    );
  } else if (status === 'failed') {
    body = (
      <div data-pl-part="list-failed">
        <ErrorBody
          title="Couldn't list the installed plugins"
          onRetry={() => {
            model.refresh();
          }}
        />
      </div>
    );
  } else if (count === 0) {
    body = (
      <div data-pl-part="list-empty">
        <EmptyBody title="No plugins installed" hint="Plugins add pages, tools and connections to Omniview." />
      </div>
    );
  } else {
    body = (
      <RovingGroup label="Plugin list" kind="column">
        {ids.map((id) => (
          <Row key={id} model={model} id={id} selected={id === selected} />
        ))}
      </RovingGroup>
    );
  }

  return (
    <section className={styles.list} aria-label="Installed plugins" data-pl-part="list">
      <div className={styles.head} data-pl-part="list-head">
        <Text as="h2" variant="title">
          Installed
        </Text>
        {status === 'ready' ? <span className={styles.count}>{count.toLocaleString('en-US')}</span> : null}
      </div>
      <div className={styles.scroll} data-pl-part="list-scroll">
        {body}
      </div>
      {status === 'ready' ? <CollectionFooter shown={count} total={{ kind: 'exact', value: count }} noun="plugin" plural="plugins" data-pl-part="list-foot" /> : null}
    </section>
  );
}
