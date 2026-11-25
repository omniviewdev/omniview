import { DataView, IconButton, MissingValue, Status, tip, type DataTableColumn } from '@omniviewdev/kit';
import { createContext, useContext, useSyncExternalStore, type ReactElement } from 'react';
import { PanelEmpty } from '../PanelEmpty';
import type { OpenSubject } from '../subject';
import styles from './Problems.module.css';
import { PROBLEMS_EMPTY, PROBLEMS_EMPTY_ICON, OPEN_ICON } from './tool';
import type { Condition, Problems } from './types';
import { NO_PAGE, NO_TARGET, openLabel, PROBLEM_NOUNS, PROBLEMS_LABEL, ROLE_OF } from './words';

// The body of the Problems tool (ch16 S121; the mock's shell-panel.js 2211-2238): the conditions that are true now as one table, the Condition (a status of the severity, with the producer's own word), the Source (the plugin),
// the Target (what it is about) and the button that opens the row's subject; while none is true, the panel's empty state. It reads the model through `useSyncExternalStore`, so it renders when the model said something changed
// and for nothing else, and the model keeps every row's object while it says the same, so a row renders only when its own condition did (the kit's table renders a row when its object changes).
//
// First slice (docs/ui-next/status/PT1.md): no Since column (no producer says when a plugin's or a connection's condition began), no filters, no toolbar and no inspector. Each is a later slice, and no control stands in for
// work that is not built. A row goes to its subject; the button in the row does the same as the row's click, because a row is not a Tab stop and every control is one (A14).

/** The open command of the window, which the buttons of the rows reach without the stable column list having to know it: the list is made once, and a cell is a function of its row alone. */
const OpenContext = createContext<OpenSubject | null>(null);

function useOpen(): OpenSubject {
  const open = useContext(OpenContext);
  if (open === null) {
    throw new Error('A row of the Problems tool was rendered outside its body.');
  }

  return open;
}

/** The kit's one icon button for a command in a row, named for its action and its object. A row with no page keeps the button, which says why it does nothing (a disabled control that vanished would leave the row's action unexplained). */
function OpenButton({ condition }: { readonly condition: Condition }) {
  const open = useOpen();
  const { subject } = condition;
  return (
    <IconButton
      icon={OPEN_ICON}
      label={openLabel(condition)}
      variant="ghost"
      size="row"
      disabledReason={subject === undefined ? NO_PAGE : undefined}
      onClick={(event) => {
        if (subject !== undefined) {
          open(subject, event);
        }
      }}
    />
  );
}

/**
 * The Condition cell: the severity's glyph and the producer's own word, the kit's status, with the full sentence as its tooltip (a tip never alone carries a fact: design 13 R2, so the sentence is also in the cell, for a
 * screen reader, unless it is the word itself). The status is a direct child of the cell, where the table's own rules take it out of the line's baseline and keep the row 24 px high.
 */
function ConditionCell({ condition }: { readonly condition: Condition }) {
  return (
    <>
      <Status role={ROLE_OF[condition.severity]} {...tip(condition.title)}>
        {condition.label}
      </Status>
      {condition.title === condition.label ? null : <span className={styles.description}>{condition.title}</span>}
    </>
  );
}

/**
 * The columns, made once: a cell is a function of its row alone (the table renders a cell again only when its row changes), and `open` is reached through the context. The identity column is the Condition, the only flexible
 * one: it takes the room the three fixed columns leave (the mock's pinned column collapsed to 14 to 37 px). `text` is what the table measures to fit it, and `lead` the glyph and its gap before it (16 and 4 px).
 */
const COLUMNS: ReadonlyArray<DataTableColumn<Condition>> = [
  { id: 'condition', header: 'Condition', fit: 'id', lead: 20, cell: (row) => <ConditionCell condition={row} />, text: (row) => row.label },
  {
    id: 'source',
    header: 'Source',
    fit: 'fixed',
    width: 144,
    cell: (row) => (
      <span className={styles.clip} data-ov-clip="">
        {row.source.name}
      </span>
    ),
  },
  {
    id: 'target',
    header: 'Target',
    fit: 'fixed',
    width: 200,
    cell: (row) =>
      row.target === undefined ? (
        <MissingValue name={NO_TARGET} />
      ) : (
        <span className={styles.clip} data-ov-clip="">
          {row.target}
        </span>
      ),
  },
  { id: 'open', header: 'Actions', hideHeader: true, fit: 'fixed', width: 48, cell: (row) => <OpenButton condition={row} /> },
];

const keyOf = (row: Condition): string => row.key;

type ProblemsBodyProps = {
  /** What is true now. */
  readonly problems: Problems;
  /** Opens a row's subject: the host's, by the open model's rules (the click's modifiers pick the disposition). */
  readonly open: OpenSubject;
};

export function ProblemsBody({ problems, open }: ProblemsBodyProps): ReactElement {
  const { rows } = useSyncExternalStore(problems.subscribe, problems.getSnapshot);
  if (rows.length === 0) {
    return <PanelEmpty icon={PROBLEMS_EMPTY_ICON} title={PROBLEMS_EMPTY.title} hint={PROBLEMS_EMPTY.hint} />;
  }

  return (
    <OpenContext value={open}>
      <div className={styles.problems} data-shell-part="problemsBody">
        <div className={styles.view}>
          <DataView<Condition>
            label={PROBLEMS_LABEL}
            table={{
              rows,
              getRowKey: keyOf,
              columns: COLUMNS,
              lines: 1,
              rowsAreImmutable: true,
              onRowActivate: (row, event) => {
                if (row.subject !== undefined) {
                  open(row.subject, event);
                }
              },
            }}
            footer={{ shown: rows.length, total: { kind: 'exact', value: rows.length }, noun: PROBLEM_NOUNS.one, plural: PROBLEM_NOUNS.other }}
          />
        </div>
      </div>
    </OpenContext>
  );
}
