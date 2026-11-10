/**
 * The contract between the page sampler (page/capture.ts, bundled into the app build) and the
 * runner that reads its results.
 *
 * The page is built once and run later, so the two can drift apart: a runner edited after the
 * build reads results an older page never produced, and a field the page no longer fills used to
 * come out as null in the report. The runner therefore compares schemas before it measures
 * anything and checks every trial against what its capture mode promises. A mismatch fails the
 * trial with a precise reason instead of reporting a required field as missing.
 *
 * Bump CAPTURE_SCHEMA whenever the page's result shape or its option handling changes.
 */
export const CAPTURE_SCHEMA = 'ov-bench-capture/v2';

/** Why the page cannot be read by this runner, or null when its schema is the runner's. */
export function schemaMismatch(pageSchema) {
  if (pageSchema === CAPTURE_SCHEMA) return null;
  return `the page's capture schema is ${JSON.stringify(pageSchema)} and the runner's is ${JSON.stringify(CAPTURE_SCHEMA)}: the page was built by a different harness revision, so rebuild it with this runner`;
}

/**
 * What is wrong with one trial's page capture, judged against its mode. Empty when the capture is
 * complete. `flat` is the analyzed trial (`analyzeTrial().flat`), `kind` the workload kind.
 *
 * - `full` promises frame intervals, viewport coverage, the scroll position over the input window,
 *   input accounting and, for wheel workloads, lag behind the declared input.
 * - `frames` promises frame intervals only: coverage, position and lag are null by design.
 * - `off` has no page capture to check.
 */
export function captureProblems({ captureMode, capture, flat, kind }) {
  if (captureMode === 'off') return [];
  if (!capture) return [`capture mode ${captureMode} returned no capture`];
  const problems = [];
  const mismatch = schemaMismatch(capture.schema);
  if (mismatch) problems.push(mismatch);
  if (capture.frames?.supported === false || !(flat.frames > 0)) problems.push('no frame intervals fall in the input window');
  if (captureMode !== 'full') return problems;

  if (capture.coverage?.supported !== true) {
    problems.push(capture.scroller ? 'coverage was not captured' : 'the page found no table scroller, so coverage was not captured');
  } else if (!(capture.series?.coverage?.t?.length > 0)) {
    problems.push('coverage sampling produced no samples');
  } else if (flat.coverageMean === null) {
    problems.push('no coverage sample falls in the input window');
  }
  if (flat.deliveredPxAtInputEnd === null) problems.push('the scroll position at the end of input is missing');
  if (capture.input?.supported !== true) problems.push('input accounting was not captured');
  if (kind !== 'jump' && flat.lagP95Px === null) problems.push('the scroll lag behind the declared input is missing');
  return problems;
}
