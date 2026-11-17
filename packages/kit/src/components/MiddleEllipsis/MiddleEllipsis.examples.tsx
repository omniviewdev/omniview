import { MiddleEllipsis } from '@omniviewdev/kit';

/** Twelve characters or fewer: one line, cut at the end if the box is too narrow. */
export const Short = () => <MiddleEllipsis>worker-0</MiddleEllipsis>;

/** A generated name: when the box is too narrow the start gives way and `-7x5nx`, which tells siblings apart, stays whole. */
export const GeneratedName = () => <MiddleEllipsis tail={6}>report-renderer-7d8c6f49b-7x5nx</MiddleEllipsis>;

/** The same with a longer start: the box here is narrower than the name, so it is cut. */
export const LongGeneratedName = () => <MiddleEllipsis tail={6}>payments-reconciliation-worker-6f9d8b7c5d-x7k2m</MiddleEllipsis>;

/** The caller says how many characters stay: a timestamp suffix is longer than a hash. */
export const Timestamped = () => <MiddleEllipsis tail={9}>nightly-backup-28733280</MiddleEllipsis>;

/** No tail given: a third of the name stays, from 6 to 12 characters. */
export const DefaultTail = () => <MiddleEllipsis>a-long-name-with-no-tail-rule-at-all-1234567</MiddleEllipsis>;

/** The longest name that is not split. */
export const TwelveCharacters = () => <MiddleEllipsis>exactly-12ch</MiddleEllipsis>;

/** The shortest name that is. */
export const ThirteenCharacters = () => <MiddleEllipsis>exactly-13chr</MiddleEllipsis>;
