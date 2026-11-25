import { SegmentedControl, type SegmentedOption } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './SegmentedControl.examples.module.css';

// A control written the way a consumer writes it: the caller owns the value.
type View = 'table' | 'cards' | 'list';

const text: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table' },
  { value: 'cards', label: 'Cards' },
  { value: 'list', label: 'List' },
];

// The mock's view switcher: a glyph and a label in each of its two segments.
const viewSwitcher: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'layout-grid' },
];

const withIcons: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'layout-grid' },
  { value: 'list', label: 'List', icon: 'layout-list' },
];

const iconOnly: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', icon: 'table', tip: 'Table' },
  { value: 'cards', icon: 'layout-grid', tip: 'Cards' },
  { value: 'list', icon: 'layout-list', tip: 'List' },
];

const oneUnavailable: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table', icon: 'table' },
  { value: 'cards', label: 'Cards', icon: 'layout-grid' },
  { value: 'list', label: 'List', icon: 'layout-list', disabledReason: 'The list view is not available for this collection.' },
];

function Stateful({ options, initial = 'table' }: { readonly options: ReadonlyArray<SegmentedOption<View>>; readonly initial?: View }) {
  const [view, setView] = useState<View>(initial);
  return <SegmentedControl label="View as" options={options} value={view} onValueChange={setView} />;
}

/** Text only: one Tab stop; the arrows move and choose, Home and End go to the ends. */
export const TextOnly = () => <Stateful options={text} />;

/** A glyph before each label, as the mock's view switcher draws its two segments. */
export const IconAndText = () => <Stateful options={viewSwitcher} initial="cards" />;

/** Glyphs alone: the tip of each option is its name. */
export const IconOnly = () => <Stateful options={iconOnly} />;

/** An option that cannot be chosen says why in its tooltip and description; the arrows skip it. */
export const OneOptionUnavailable = () => <Stateful options={oneUnavailable} />;

/** In a box narrower than its options the strip scrolls sideways and never wraps. */
export const NarrowContainer = () => (
  <div className={styles.narrow}>
    <Stateful options={withIcons} />
  </div>
);
