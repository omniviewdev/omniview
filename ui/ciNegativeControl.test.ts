// TEMPORARY negative control for the PR Checks aggregator (N24 U1). It fails on purpose and is never merged.
it('N24 U1 negative control: this failing component test must turn UI checks red', () => {
  expect(1).toBe(2);
});
