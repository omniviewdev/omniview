import { Stack, Status } from '@omniviewdev/kit';

/** A good verdict or outcome: the filled check, pinned to the success colour. */
export const Healthy = () => <Status role="healthy">Passed</Status>;

/** Up and doing its work: the play glyph. It asserts no verdict, so it is not the check. */
export const Running = () => <Status role="running">Running</Status>;

/** Work under way: the loader. */
export const InProgress = () => <Status role="progress">Shutting down</Status>;

/** Work that waits to start: the clock, still the progress role. */
export const Queued = () => (
  <Status role="progress" queued>
    Pending
  </Status>
);

/** Needs a look and is not broken: the warning glyph. */
export const Attention = () => <Status role="attention">Attention</Status>;

/** It failed or cannot work: the error glyph. The platform's word keeps its spelling. */
export const Failed = () => <Status role="error">Failed</Status>;

/** Stopped, disabled or disconnected, with nothing wrong: the minus in a circle. */
export const Stopped = () => <Status role="stopped">Stopped</Status>;

/** An informational message or an available update. */
export const Info = () => <Status role="info">Update available</Status>;

/** The whole table in one column: the glyphs share one left axis, whatever the length of the word. */
export const AllRoles = () => (
  <Stack gap={8} align="start">
    <Status role="healthy">Passed</Status>
    <Status role="running">Running</Status>
    <Status role="progress">Shutting down</Status>
    <Status role="progress" queued>
      Pending
    </Status>
    <Status role="attention">Attention</Status>
    <Status role="error">Failed</Status>
    <Status role="stopped">Stopped</Status>
    <Status role="info">Update available</Status>
  </Stack>
);

/** A boolean is not a state: it prints as plain words, with no glyph, whatever role it was given. */
export const BooleanWord = () => <Status role="stopped">No</Status>;
