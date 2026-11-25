import { Disclosure, IconButton, Stack } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './Disclosure.examples.module.css';

/** Closed: the trigger alone, a chevron pointing right. The body is not mounted. */
export const Closed = () => <Disclosure title="Advanced options">Options that most people leave as they are.</Disclosure>;

/** Open: the chevron turns down and the body follows, inset 4/8/8. */
export const Open = () => (
  <Disclosure title="Advanced options" defaultOpen>
    Options that most people leave as they are.
  </Disclosure>
);

/** A muted fragment at the end of the trigger: a summary of what is inside. */
export const WithMeta = () => (
  <Disclosure title="Match rules" meta="AND · 2">
    Items match when both rules hold.
  </Disclosure>
);

/** A control after the trigger: a sibling of the heading, so it is its own Tab stop. */
export const WithAside = () => (
  <Disclosure title="Rule 1" meta="Review rule" aside={<IconButton icon="trash" label="Remove rule 1" variant="ghost" />} defaultOpen>
    Name contains "orders".
  </Disclosure>
);

/** The caller owns the state: `open` and `onOpenChange`, here kept in a hook. */
export const Controlled = () => {
  const [open, setOpen] = useState(true);
  return (
    <Disclosure title="Advanced options" meta={open ? 'Shown' : 'Hidden'} open={open} onOpenChange={setOpen}>
      Options that most people leave as they are.
    </Disclosure>
  );
};

/** Rows of rules, each its own disclosure with a summary title, an index and a Remove control. */
export const NestedRuleRows = () => (
  <Disclosure title="Rules" meta="2" level={3} defaultOpen>
    <Stack gap={4}>
      <Disclosure title="Name contains orders" meta="1" level={4} aside={<IconButton icon="trash" label="Remove rule 1" variant="ghost" />} defaultOpen>
        Matches on the name, ignoring case.
      </Disclosure>
      <Disclosure title="Group is empty" meta="Review rule" level={4} aside={<IconButton icon="trash" label="Remove rule 2" variant="ghost" />} />
    </Stack>
  </Disclosure>
);

/** A long title wraps onto the next line and the meta keeps the end. */
export const LongTitle = () => (
  <div className={styles.narrow}>
    <Disclosure title="Name contains a long word that has to wrap in a narrow column" meta="2" />
  </div>
);
