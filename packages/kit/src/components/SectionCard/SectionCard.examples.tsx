import { Button, IconButton, KeyValue, SectionCard, TagList } from '@omniviewdev/kit';
import styles from './SectionCard.examples.module.css';

/** A title and nothing else: the lane is 29 px, a 28 px lane and its 1 px rule. A section with no body draws no body. */
export const TitleOnly = () => <SectionCard title="Details" />;

/** A muted fragment after the title: a count, or the scope the section is about. */
export const WithMeta = () => <SectionCard title="Replicas" meta="3" />;

/** A command at the end of the lane: a ghost button of the row size, which keeps the lane at its height. */
export const WithAction = () => (
  <SectionCard
    title="Usage"
    actions={
      <Button variant="ghost" size="row" icon="refresh">
        Metrics
      </Button>
    }
  />
);

/** The fragment and the commands together: the fragment follows the title, the commands trail, 8 px apart. */
export const WithMetaAndAction = () => (
  <SectionCard
    title="Replicas"
    meta="3"
    actions={
      <>
        <IconButton icon="search" label="Search replicas" variant="ghost" size="row" />
        <Button variant="ghost" size="row">
          View all
        </Button>
      </>
    }
  />
);

/** A padded body: key-value rows, chips and text sit on the section's inset, 12 px above and below. */
export const PaddedBody = () => (
  <SectionCard title="Details" pad>
    <KeyValue
      columns={2}
      rows={[
        { label: 'Name', value: 'orders-api' },
        { label: 'Group', value: 'checkout' },
        { label: 'Created', value: '2026-11-13 09:42' },
        { label: 'Owner', value: 'north-yard' },
      ]}
    />
  </SectionCard>
);

/** Text in a padded body. */
export const PaddedText = () => (
  <SectionCard title="Description" pad>
    Receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment.
  </SectionCard>
);

/** A table sits flush: no `pad`, so its rows run the full width of the section under the rule. */
export const FlushTable = () => (
  <SectionCard title="Conditions" meta="2">
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Type</th>
          <th scope="col">Status</th>
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Available</td>
          <td>True</td>
          <td>MinimumReplicasAvailable</td>
        </tr>
        <tr>
          <td>Progressing</td>
          <td>True</td>
          <td>NewReplicaSetAvailable</td>
        </tr>
      </tbody>
    </table>
  </SectionCard>
);

/** The same look at the next level: a section below a section of the page is an h3, and an h4 below that. */
export const LevelThree = () => (
  <SectionCard title="Containers" level={3} meta="2" pad>
    Two containers run in each replica.
  </SectionCard>
);

/** The fourth level. */
export const LevelFour = () => (
  <SectionCard title="Init containers" level={4} pad>
    One container runs before the others start.
  </SectionCard>
);

/** A title that is longer than the lane clips with an ellipsis, and the commands keep their place. */
export const LongTitle = () => (
  <div className={styles.narrow}>
    <SectionCard
      title="Recent warnings from the orders-api rollout in the north-yard group"
      meta="12"
      actions={
        <Button variant="ghost" size="row">
          Events
        </Button>
      }
    />
  </div>
);

/** The Labels section of a page's aside: chips in a padded body, the count in the lane, in the 342 px column. */
export const LabelsSection = () => (
  <div className={styles.narrow}>
    <SectionCard title="Labels" meta="3" pad>
      <TagList
        label="Labels"
        items={[
          { key: 'app', value: 'orders-api' },
          { key: 'tier', value: 'backend' },
          { key: 'owner', value: 'north-yard' },
        ]}
      />
    </SectionCard>
  </div>
);
