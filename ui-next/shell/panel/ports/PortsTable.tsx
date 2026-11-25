import { useMenu } from '@omniviewdev/kit';
import type { PortRow } from './model';
import { portsMenu, type PortsActions } from './portsMenu';
import styles from './PortsBody.module.css';
import { Row } from './PortsRow';

type PortsTableProps = {
  readonly rows: readonly PortRow[];
  /** The row whose port or address was copied a moment ago. */
  readonly copied: string | undefined;
  readonly actions: PortsActions;
};

/**
 * The table of forwards: a native table named for what it lists, with the columns of the mock (Resource, Mapping, Connection, Status, and the commands, whose header is named and not drawn), and a row for each forward in the order the
 * store gives. The header is sticky to the scroller that holds the table (the body's).
 *
 * The row menu is one definition for the whole table, on the window's one menu host (docs/ui-next/status/kit-menus.md): each row is a trigger of it, keyed by its forward's id, and the host asks for the items of the row it opened on when it
 * opens. So a row has no menu, no popup and no listener of its own, and a table of any size adds nothing for it. The revision is the rows: a menu that is open when what a row can do changes is put away, because its items were read
 * when it opened and a stale one would offer what is no longer so. A press on the check mark of Copy changes no row, so it puts nothing away.
 */
export function PortsTable({ rows, copied, actions }: PortsTableProps) {
  const menu = useMenu((key) => {
    const row = key === undefined ? undefined : rows.find((candidate) => candidate.id === key);
    return row === undefined ? null : portsMenu(row, actions);
  }, rows);
  const named = rows.some((row) => row.connection !== '');

  return (
    <table className={styles.table} aria-label="Forwarded ports" data-ports-part="table" data-ports-names={named ? '' : undefined}>
      <thead>
        <tr>
          <th scope="col" className={styles.head} data-column="resource">
            Resource
          </th>
          <th scope="col" className={styles.head} data-column="mapping">
            Mapping
          </th>
          <th scope="col" className={styles.head} data-column="connection">
            Connection
          </th>
          <th scope="col" className={styles.head} data-column="status">
            Status
          </th>
          <th scope="col" className={styles.head} data-column="actions">
            <span className={styles.hidden}>Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.id} row={row} copied={copied === row.id} actions={actions} menu={menu} />
        ))}
      </tbody>
    </table>
  );
}
