import { SegmentedControl, type SegmentedOption } from '@omniviewdev/kit';
import { useState } from 'react';
import styles from './SegmentedControl.examples.module.css';

// A control written the way a consumer writes it: the caller owns the value.
type View = 'table' | 'cards' | 'debug';

const text: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table' },
  { value: 'cards', label: 'Cards' },
  { value: 'debug', label: 'Debug' },
];

const withIcons: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table', icon: 'list-ordered' },
  { value: 'cards', label: 'Cards', icon: 'layers' },
  { value: 'debug', label: 'Debug', icon: 'code' },
];

const iconOnly: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', icon: 'list-ordered', tip: 'Table' },
  { value: 'cards', icon: 'layers', tip: 'Cards' },
  { value: 'debug', icon: 'code', tip: 'Debug' },
];

const oneUnavailable: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table', icon: 'list-ordered' },
  { value: 'cards', label: 'Cards', icon: 'layers' },
  { value: 'debug', label: 'Debug', icon: 'code', disabledReason: 'Debug view is off in this build.' },
];

function Stateful({ options, initial = 'table' }: { readonly options: ReadonlyArray<SegmentedOption<View>>; readonly initial?: View }) {
  const [view, setView] = useState<View>(initial);
  return <SegmentedControl label="View as" options={options} value={view} onValueChange={setView} />;
}

/** Text only: one Tab stop; the arrows move and choose, Home and End go to the ends. */
export const TextOnly = () => <Stateful options={text} />;

/** A glyph before each label. */
export const IconAndText = () => <Stateful options={withIcons} initial="cards" />;

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
