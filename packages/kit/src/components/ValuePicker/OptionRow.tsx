import { memo } from 'react';
import { dataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import { tip } from '../TooltipHost';
import styles from './ValuePicker.module.css';

type RowProps = {
  /** The id the field's `aria-activedescendant` names. */
  readonly id: string;
  /** The row's place in the list: the delegated handlers of the list read it from the row. */
  readonly index: number;
  /** How many rows the list has, for the rows that are not mounted. */
  readonly size: number;
  readonly label: string;
  readonly description: string | undefined;
  /** Why the option cannot be chosen: the row is unavailable, says this in its second line in the place of its description, and has it as its tooltip. */
  readonly reason: string | undefined;
  readonly selected: boolean;
  readonly active: boolean;
};

/**
 * One option of the list. It takes only plain values, and holds no handler of its own (the list has one for every row), so a change of the
 * choice renders only the rows whose own values changed: the one that was chosen or left, and the one that was active and the one that is.
 */
export const OptionRow = memo(function OptionRow({ id, index, size, label, description, reason, selected, active }: RowProps) {
  const detail = reason ?? description;
  return (
    <div
      {...dataAttributes(tip(reason))}
      id={id}
      role="option"
      className={styles.option}
      data-ov-index={index}
      data-ov-active={active ? '' : undefined}
      aria-selected={selected}
      aria-disabled={reason === undefined ? undefined : 'true'}
      aria-posinset={index + 1}
      aria-setsize={size}
    >
      <span className={styles.body}>
        <span className={styles.label}>{label}</span>
        {detail === undefined ? null : <span className={styles.description}>{detail}</span>}
      </span>
      <span className={styles.mark} aria-hidden="true">
        {selected ? <Icon name="check" size={12} /> : null}
      </span>
    </div>
  );
});
