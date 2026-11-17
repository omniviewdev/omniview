import { KindTile, MiddleEllipsis, MissingValue, Status, compactAge, useAge } from '@omniviewdev/kit';
import { useState } from 'react';
import { podDefinition, type Cell, type PodField, type PodRow, type PodSortId } from '../k8s';
import styles from './cells.module.css';

// What a Pods row draws in its cells, from the Pod definition's closed vocabulary of cells (`text`, `status`, `age`, `none`) and kit atoms. The
// definition decides what a field says; this file decides how it is drawn. Plugin scaffolding: it imports the kit and the data layer only.

function fieldOf(id: PodSortId): PodField {
  const field = podDefinition.fields.find((candidate) => candidate.id === id);
  if (field === undefined) {
    throw new Error(`The Pod definition has no field ${id}`);
  }

  return field;
}

const READY = fieldOf('ready');
const STATUS = fieldOf('status');
const RESTARTS = fieldOf('restarts');
const AGE = fieldOf('age');

/**
 * The Name column: the kind's tile, the name, and the namespace under it. A generated name keeps its distinguishing end when it is cut. A cut name is
 * two spans in a flex row, which assistive technology reads as two words (`alertmanager-5d5bcf5596 -qxv45`): the drawn name is hidden from it and the
 * whole name is in the cell once, for it (found by the real-engine probe, in both engines).
 */
export function IdentityCell({ row }: { readonly row: PodRow }) {
  const { second, tail } = podDefinition.list.identity;
  const namespace = second(row);
  return (
    <div className={styles.identity}>
      <KindTile icon="box" tone="blue" />
      <div className={styles.lines}>
        <span aria-hidden="true">
          <MiddleEllipsis data-testid="pod-name" tail={tail(row)}>
            {row.name}
          </MiddleEllipsis>
        </span>
        <span className={styles.name} data-testid="pod-name-text">
          {row.name}
        </span>
        {namespace === null ? null : (
          <small className={styles.second} data-testid="pod-namespace">
            {namespace}
          </small>
        )}
      </div>
    </div>
  );
}

/** A cell that does not read the clock: Ready, Status and Restarts. An age that comes here is drawn as the definition words it, still. */
function Plain({ cell }: { readonly cell: Cell }) {
  switch (cell.kind) {
    case 'text':
      return cell.mono === true ? <span className={styles.mono}>{cell.text}</span> : cell.text;
    case 'status':
      // Work that waits to start is drawn with the clock, work under way with the loader (design 13 SR1; plan E8).
      return cell.role === 'progress' ? (
        <Status role="progress" queued={cell.raw === 'Pending'}>
          {cell.label}
        </Status>
      ) : (
        <Status role={cell.role}>{cell.label}</Status>
      );
    case 'none':
      return <MissingValue reason={cell.reason} />;
    case 'age':
      return cell.text;
  }
}

export const ReadyCell = ({ row }: { readonly row: PodRow }) => <Plain cell={READY.display(row, 0)} />;
export const StatusCell = ({ row }: { readonly row: PodRow }) => <Plain cell={STATUS.display(row, 0)} />;
export const RestartsCell = ({ row }: { readonly row: PodRow }) => <Plain cell={RESTARTS.display(row, 0)} />;

/**
 * The Age column: one unit, floored (`17d`), kept current by the page's one age clock; the instant and the span in words are the tip. The
 * tip is read at the moment the cell mounts: it is a reading aid, and the label beside it is the live one.
 */
export function AgeCell({ row }: { readonly row: PodRow }) {
  const label = useAge(row.createdAt, compactAge);
  const [now] = useState(() => Date.now());
  const cell = AGE.display(row, now);
  if (cell.kind === 'age') {
    return <span data-ov-tip={cell.long}>{label}</span>;
  }

  return <Plain cell={cell} />;
}
