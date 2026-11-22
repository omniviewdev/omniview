// The neutral plugins both sides of the Plugins page probe draw (PL1): the design mock (mock-plugins-measure.mjs writes these words into the mock's own plugin world before it opens the page) and the
// host's fixture (fixture.tsx builds its inventory from them). The same words on both sides are what lets a rectangle that depends on the width of its text be compared at all. The words are invented:
// the host and its probes name no real plugin (decision A13, AGENTS rule 15).
//
// `state` is what the plugin is doing when the page opens: `running` (a healthy plugin), `failed` (its process stopped unexpectedly), `disabled` (the person turned it off), `starting` (it is loading).
// `version`, `publisher`, `summary` and `category` are what a plugin's manifest says of itself; `license` too. Sorted by name, which is the order the page lists them in.

export const WORLD = Object.freeze([
  { id: 'alpha', name: 'Alpha Metrics', version: '1.8.2', publisher: 'Fixture Labs', category: 'Monitoring', license: 'Apache-2.0', summary: 'Dashboards and data sources for the alpha service.', state: 'running' },
  { id: 'beta', name: 'Beta Registry', version: '0.24.0', publisher: 'Fixture Labs', category: 'Containers', license: 'Apache-2.0', summary: 'Browse repositories, tags and images in the beta registry.', state: 'running' },
  { id: 'delta', name: 'Delta Vault', version: '1.0.3', publisher: 'Delta Systems', category: 'Security', license: 'MPL-2.0', summary: 'Secrets, leases and policies for a delta server.', state: 'disabled' },
  { id: 'epsilon', name: 'Epsilon Mesh', version: '0.4.1', publisher: 'Epsilon Works', category: 'Networking', license: 'Apache-2.0', summary: 'Services, routes and traffic policy for an epsilon mesh.', state: 'starting' },
  { id: 'gamma', name: 'Gamma Deploy', version: '2.3.0', publisher: 'Gamma Community', category: 'DevOps', license: 'MIT', summary: 'Rollouts, environments and the release history of a gamma project.', state: 'failed' },
  { id: 'zeta', name: 'Zeta Jobs', version: '3.1.0', publisher: 'Fixture Labs', category: 'DevOps', license: 'Apache-2.0', summary: 'Scheduled jobs, their runs and their outcomes.', state: 'running' },
]);

/** The plugin the page shows the detail of when it opens. */
export const SELECTED = 'alpha';
