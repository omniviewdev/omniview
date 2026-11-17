import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Chip, type ChipTone } from '../Chip';
import { RovingGroup } from '../RovingGroup';

/** One state filter of a strip. */
export type QuickFilter = {
  /** Identifies the filter to the caller: `onSelect` reports it, `selected` names it. */
  readonly id: string;
  /** The filter in the user's words ("Running"), never a column name (design 13 QF1). */
  readonly label: string;
  /** How many items the filter matches. Undefined while it is not known (a load in progress): the chip then shows no number. Zero is a count. */
  readonly count?: number | undefined;
  /** The state the filter stands for. It paints the chip only while the filter has items in it: an empty state is not highlighted. */
  readonly tone?: ChipTone | undefined;
};

export type QuickFiltersProps = {
  /** The strip's accessible name: what the filters are about ("Item state"). */
  readonly label: string;
  /** The count of All: every item, before the state filter. Undefined while it is not known. */
  readonly total?: number | undefined;
  /** The state filters, in order, after All. The strip always starts with All, so the caller never lists it. */
  readonly filters: readonly QuickFilter[];
  /** The id of the selected filter, or null for All. An id that names no filter is All too: exactly one chip is always pressed. */
  readonly selected: string | null;
  /**
   * The chip that was activated: its filter's id, or null for All. Called for the chip that is already selected as well; whether that
   * clears the filter is the caller's rule. The strip is controlled and changes nothing itself.
   */
  readonly onSelect: (id: string | null) => void;
} & DataAttributes;

/**
 * The quick filters of a list (design 13 QF1): a strip of toggle chips, All first, each with its count, one chosen at a time, named in
 * the user's words. It is one tab stop (Left and Right move, Home and End go to the ends). Props are closed: no `className`, no
 * `style`; `data-*` passes through. The counts are the caller's: the strip prints them as they come and adds nothing up.
 */
export function QuickFilters({ label, total, filters, selected, onSelect, ...rest }: QuickFiltersProps) {
  const active = selected !== null && filters.some((filter) => filter.id === selected) ? selected : null;

  return (
    <RovingGroup {...dataAttributes(rest)} label={label} kind="row" gap={8} wrap align="center">
      <Chip
        pressed={active === null}
        count={total}
        onClick={() => {
          onSelect(null);
        }}
      >
        All
      </Chip>
      {filters.map((filter) => (
        <Chip
          key={filter.id}
          pressed={active === filter.id}
          count={filter.count}
          tone={filter.count !== undefined && filter.count > 0 ? filter.tone : 'muted'}
          onClick={() => {
            onSelect(filter.id);
          }}
        >
          {filter.label}
        </Chip>
      ))}
    </RovingGroup>
  );
}
