import { IconButton, MiddleEllipsis, MissingValue, RovingGroup, Status, menuTrigger, tip, type StatusRole } from '@omniviewdev/kit';
import { memo } from 'react';
import { ACTION_WORDS, availabilityOf, type PortRow, type PortState } from './model';
import type { PortsActions } from './portsMenu';
import styles from './PortsBody.module.css';
import { OPEN_ICON, STOP_ICON } from './tool';

// One forward's row of the table: its resource, its mapping, its connection, its state, and the three commands. A row draws only its own forward and renders when that forward changes: it is given the row object, which the store keeps
// the same object while the forward says the same, and whether its address was just copied. The commands are always drawn (not on hover), as the mock's are, and are one Tab stop in the kit's roving group.

/** The kit's role for each word of state: the glyph that the role fixes goes beside the word, and the word keeps its own spelling. A forward that is paused is stopped for a reason and nothing is wrong. */
const ROLES: Readonly<Record<PortState, StatusRole>> = { running: 'running', paused: 'stopped', stopped: 'stopped', failed: 'error', stopping: 'progress' };

/** The forward as a person names it: its resource, and its mapping to tell two forwards of one resource apart. */
export const subjectOf = (row: PortRow): string => (row.resource === '' ? row.mapping : `${row.resource}, ${row.mapping}`);

/** A command's tip: its name, and under it why it cannot be used when that is so (the reason is also its description). */
const tipOf = (label: string, reason: string | undefined): string => (reason === undefined ? label : `${label}\n${reason}`);

type RowProps = {
  readonly row: PortRow;
  /** Whether this row's address was copied a moment ago: its Copy button shows a check mark. */
  readonly copied: boolean;
  readonly actions: PortsActions;
  /** The id of the table's menu, which the row is a trigger of (a secondary click on it, Shift F10 or the Menu key on a button in it). */
  readonly menu: string;
};

export const Row = memo(function Row({ row, copied, actions, menu }: RowProps) {
  const reach = availabilityOf(row);
  const subject = subjectOf(row);
  return (
    <tr data-ports-part="row" data-ports-id={row.id} data-ports-state={row.state} data-ov-menu-label={`Actions for ${subject}`} {...menuTrigger(menu, row.id, 'context')}>
      <td className={styles.cell} data-column="resource" data-ports-part="resource">
        <div className={styles.fit} data-ports-part="fit">
          {row.resource === '' ? <MissingValue name="Not reported" /> : <MiddleEllipsis>{row.resource}</MiddleEllipsis>}
          {row.reason === undefined ? null : (
            <span className={styles.reason} data-ports-part="reason" data-ov-clip="">
              {row.reason}
            </span>
          )}
        </div>
      </td>
      <td className={styles.cell} data-column="mapping">
        <span className={styles.mono} data-ports-part="mapping">
          {row.mapping}
        </span>
      </td>
      <td className={styles.cell} data-column="connection" data-ports-part="connection">
        {row.connection === '' ? (
          <MissingValue name={row.kind === 'static' ? 'Not applicable' : 'Not reported'} />
        ) : (
          <span className={styles.fit} data-ports-part="fit">
            <span className={styles.clipped} data-ov-clip="">
              {row.connection}
            </span>
          </span>
        )}
      </td>
      <td className={styles.cell} data-column="status" data-ports-part="status">
        <Status role={ROLES[row.state]} {...tip(row.reason)}>
          {row.stateWord}
        </Status>
      </td>
      <td className={styles.cell} data-column="actions" data-ports-part="actions">
        <RovingGroup label={`Port actions for ${subject}`} gap={8}>
          <IconButton
            icon={STOP_ICON}
            label={ACTION_WORDS.stop}
            variant="ghost"
            size="row"
            disabledReason={reach.stop}
            data-ports-action="stop"
            {...tip(tipOf(ACTION_WORDS.stop, reach.stop))}
            onClick={() => {
              actions.stop(row.id, row.session);
            }}
          />
          {reach.open === null ? (
            <span className={styles.slot} aria-hidden="true" />
          ) : (
            <IconButton
              icon={OPEN_ICON}
              label={ACTION_WORDS.open}
              variant="ghost"
              size="row"
              disabledReason={reach.open}
              data-ports-action="open"
              {...tip(tipOf(ACTION_WORDS.open, reach.open))}
              onClick={() => {
                actions.open(row.id, row.session);
              }}
            />
          )}
          <IconButton
            icon={copied ? 'check' : 'copy'}
            label={ACTION_WORDS.copy}
            variant="ghost"
            size="row"
            disabledReason={reach.copy}
            data-ports-action="copy"
            {...tip(tipOf(ACTION_WORDS.copy, reach.copy))}
            onClick={() => {
              actions.copy(row.id, row.session);
            }}
          />
        </RovingGroup>
      </td>
    </tr>
  );
});
