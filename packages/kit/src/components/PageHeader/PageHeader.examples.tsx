import { Button, PageHeader, Stack, type PageHeaderCommands, type PageOperation } from '@omniviewdev/kit';
import { useEffect, useRef, useState } from 'react';

const noop = () => undefined;

// The commands of a detail page, in the one order the design allows (design 12 PH2): the primary, at most two secondaries, the danger command, the
// Refresh utility, and the overflow menu last. Nothing here is wired to anything: a consumer's callbacks do the work.
const detailCommands: PageHeaderCommands = {
  primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: noop },
  secondary: [
    { id: 'edit', label: 'Edit', onSelect: noop },
    { id: 'restart', label: 'Restart', onSelect: noop },
  ],
  danger: { id: 'delete', label: 'Delete', onSelect: noop },
  utility: { id: 'refresh', label: 'Refresh orders-api', onSelect: noop },
  menu: [
    { id: 'labels', label: 'Edit labels', onSelect: noop },
    { id: 'copy', label: 'Copy name', onSelect: noop },
    { id: 'remove', label: 'Remove from list\u2026', destructive: true, onSelect: noop },
  ],
};

const path = [{ label: 'Acme', onSelect: noop }, { label: 'Items', onSelect: noop }, { label: 'orders-api' }] as const;

const facts = [
  { text: 'i-02048ad7d2f67a78c', mono: true, copy: { label: 'id', onCopy: noop } },
  { text: 'Deployment' },
  { text: 'checkout' },
  { text: '3d' },
] as const;

/** A list's header: the title and the Refresh utility. No tile, no state, no breadcrumb, so no identity line and no band under the title. */
export const List = () => <PageHeader title="Items" commands={{ utility: { id: 'refresh', label: 'Refresh items', onSelect: noop } }} />;

/** A list that can create: the primary at the start of the lane, the utility, and the overflow menu last. Three controls stay on the title row. */
export const ListWithCreate = () => (
  <PageHeader
    title="Items"
    commands={{
      primary: { id: 'create', label: 'Create item', onSelect: noop },
      utility: { id: 'refresh', label: 'Refresh items', onSelect: noop },
      menu: [{ id: 'selector', label: 'Label selector\u2026', onSelect: noop }],
    }}
  />
);

/** A resource page: breadcrumb, the tile of its kind, the one h1, the state first and then four facts, and the whole lane. The header is 84 px. */
export const Detail = () => (
  <PageHeader
    path={path}
    tile={{ icon: 'layers', tone: 'blue' }}
    title="orders-api"
    state={{ role: 'running', label: 'Running' }}
    facts={facts}
    commands={detailCommands}
  />
);

/** A name and facts longer than their room: the title ends in an ellipsis, the facts keep their size and only the last gives way, and the Copy button stays whole. The identity line is still one line. */
export const DetailLong = () => (
  <PageHeader
    path={path}
    tile={{ icon: 'layers', tone: 'blue' }}
    title="orders-api-with-a-name-that-is-much-longer-than-the-room-its-commands-leave-it"
    state={{ role: 'attention', label: 'Degraded' }}
    facts={[
      { text: 'i-02048ad7d2f67a78c-and-a-long-identifier', mono: true, copy: { label: 'id', onCopy: noop } },
      { text: 'A deployment with a descriptive kind' },
      { text: 'a-group-with-a-long-name-too' },
      { text: 'created three days ago in the eu region' },
    ]}
    commands={detailCommands}
  />
);

/** A command that cannot be used keeps its button, and the first reason is written in the identity line, where it is read (design 14 P2). */
export const DisabledReason = () => (
  <PageHeader
    path={path}
    tile={{ icon: 'layers', tone: 'blue' }}
    title="orders-api"
    state={{ role: 'running', label: 'Running' }}
    facts={facts}
    commands={{ ...detailCommands, primary: { id: 'scale', label: 'Scale', icon: 'layers', onSelect: noop, disabledReason: 'Another change is running' } }}
  />
);

/** Overflow entries as a menu draws them: a 16 px glyph, a separator that sets a group apart, an entry disabled with its reason (the tip, still focusable), and the destructive entry last. */
export const OverflowEntries = () => (
  <PageHeader
    title="Items"
    commands={{
      utility: { id: 'refresh', label: 'Refresh items', onSelect: noop },
      menu: [
        { id: 'add-group', label: 'Create group\u2026', icon: 'plus', onSelect: noop },
        { id: 'copy', label: 'Copy list link', icon: 'copy', onSelect: noop },
        { id: 'order', label: 'Change group order\u2026', icon: 'layers', separatorBefore: true, disabled: 'Create a group to change the order.', onSelect: noop },
        { id: 'open', label: 'Open in a window', icon: 'external-link', onSelect: noop },
        { id: 'clear', label: 'Clear list\u2026', icon: 'trash', destructive: true, onSelect: noop },
      ],
    }}
  />
);

/** A flow's header has no state and no facts: one plain muted note under the title, 16 px. */
export const Note = () => <PageHeader title="Create item" level={2} note="Name and group · step 1 of 3" />;

// An operation is the caller's record; these hold one phase each.
const running: PageOperation = {
  title: 'Scale orders-api',
  state: 'running',
  text: 'Scaling orders-api: 2 of 5 replicas',
  progress: 0.4,
  actions: [{ id: 'cancel', kind: 'cancel', label: 'Cancel', onSelect: noop }],
};

const succeeded: PageOperation = {
  title: 'Scale orders-api',
  state: 'succeeded',
  text: 'Scaled orders-api to 5 replicas',
  onDismiss: noop,
};

const failed: PageOperation = {
  title: 'Scale orders-api',
  state: 'failed',
  text: 'The API server refused: the quota allows 3 replicas.',
  actions: [{ id: 'retry', kind: 'retry', label: 'Retry', onSelect: noop }],
  onDismiss: noop,
};

const withOperation = (operation: PageOperation | null) => (
  <PageHeader
    path={path}
    tile={{ icon: 'layers', tone: 'blue' }}
    title="orders-api"
    state={{ role: 'running', label: 'Running' }}
    facts={facts}
    commands={detailCommands}
    operation={operation}
  />
);

/** The slot at rest: it is there, at the end of the identity line, and it has no width and no line of its own, so the header is exactly as tall as one with no slot. */
export const OperationRest = () => withOperation(null);

/** While work runs the slot shows one step label over a 4 px track, and Cancel; it is 360 px wide (480 px from 1000 px of page width) and the line stays 28 px. */
export const OperationRunning = () => withOperation(running);

/** A success is one sentence on up to two lines in the same cell, and Dismiss; it clears itself 8 s later, unless the pointer or the focus is in it. */
export const OperationSucceeded = () => withOperation(succeeded);

/** A failure stays until it is dismissed: the sentence, a Retry as the primary command, and Dismiss. */
export const OperationFailed = () => withOperation(failed);

const STEPS = 5;

/** The whole life of an operation, driven by buttons: start it, let it fail on the second step, cancel it, retry, dismiss. Nothing below the header moves in any phase. */
export const OperationLive = () => {
  const [record, setRecord] = useState<PageOperation | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const fails = useRef(false);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const finish = (next: PageOperation) => {
    window.clearTimeout(timer.current);
    setRecord(next);
  };

  const dismiss = () => {
    window.clearTimeout(timer.current);
    setRecord(null);
  };

  const run = (step: number) => {
    if (fails.current && step === 2) {
      finish({
        title: 'Scale orders-api',
        state: 'failed',
        text: 'The API server refused: the quota allows 3 replicas.',
        actions: [
          {
            id: 'retry',
            kind: 'retry',
            label: 'Retry',
            onSelect: () => {
              fails.current = false;
              run(1);
            },
          },
        ],
        onDismiss: dismiss,
      });
      return;
    }

    if (step > STEPS) {
      finish({ title: 'Scale orders-api', state: 'succeeded', text: 'Scaled orders-api to 5 replicas', onDismiss: dismiss });
      return;
    }

    setRecord({
      title: 'Scale orders-api',
      state: 'running',
      text: `Scaling orders-api: ${String(step)} of ${String(STEPS)} replicas`,
      progress: step / STEPS,
      actions: [
        {
          id: 'cancel',
          kind: 'cancel',
          label: 'Cancel',
          onSelect: () => {
            finish({ title: 'Scale orders-api', state: 'cancelled', text: 'Stopped before every replica was started', onDismiss: dismiss });
          },
        },
      ],
    });
    timer.current = window.setTimeout(() => {
      run(step + 1);
    }, 1400);
  };

  const start = () => {
    run(1);
  };

  return (
    <Stack gap={12}>
      {withOperation(record)}
      <Stack direction="row" gap={8}>
        <Button
          onClick={() => {
            fails.current = false;
            start();
          }}
        >
          Run an operation
        </Button>
        <Button
          onClick={() => {
            fails.current = true;
            start();
          }}
        >
          Run one that fails
        </Button>
      </Stack>
    </Stack>
  );
};
