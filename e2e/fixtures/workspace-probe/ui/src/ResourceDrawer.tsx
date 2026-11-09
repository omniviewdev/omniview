import type { ReactNode } from 'react';
import { moduleInstance } from './probeState';

// Structural mirror of the host's drawer contract: the probe pins the published runtime.
type ProbeDrawerContext = { readonly data?: unknown };
type ProbeDrawer = {
  title: string;
  views: Array<{ title: string; component: (ctx: ProbeDrawerContext) => ReactNode }>;
  actions: [];
};

function ProbeDrawerView({ data }: ProbeDrawerContext) {
  return (
    <section data-testid="probe-drawer-view">
      <p>
        Probe drawer for{' '}
        <strong data-testid="probe-drawer-name">
          {typeof data === 'object' && data !== null && 'name' in data ? String(data.name) : 'unknown'}
        </strong>
      </p>
      <small>
        module instance <output data-testid="probe-drawer-instance">{moduleInstance}</output>
      </small>
    </section>
  );
}

// Legacy drawer export, keyed by the opaque resource type the probe's provider serves. The host
// calls the factory when a row opens its drawer, so each opening reflects the bundle that is
// loaded at that moment.
export const resourceDrawers: Record<string, (closeDrawer: () => void) => ProbeDrawer> = {
  vm: () => ({
    title: 'Probe VM',
    views: [{ title: 'Probe view', component: (ctx) => <ProbeDrawerView data={ctx.data} /> }],
    actions: [],
  }),
};
