import type { ComponentType } from 'react';
import type { ExtensionRegistration } from '@omniviewdev/runtime';
import { contributesCell, moduleInstance } from './probeState';

// The probe pins the published runtime, so the host's resource cell contract is declared
// structurally here instead of imported: `omniview/resource/cell`, contract version 1.
const RESOURCE_CELL_EXTENSION_POINT_ID = 'omniview/resource/cell';

type ProbeCellProps = { readonly data: unknown; readonly componentParams?: unknown };

export type ProbeResourceCellV1 = {
  contractVersion: 1;
  name: string;
  resourceKeys?: readonly string[];
  providers?: readonly string[];
  component: ComponentType<ProbeCellProps>;
};

// The `ColumnDefinition.component` the probe's Go provider declares for its `vm` node column.
const NODE_CELL_COMPONENT = 'workspace-probe/node-badge';

function ProbeNodeCell({ data, componentParams }: ProbeCellProps) {
  return (
    <span data-testid="probe-cell" style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
      <strong data-testid="probe-cell-data">{typeof data === 'string' ? data : JSON.stringify(data)}</strong>
      <code data-testid="probe-cell-params">
        {componentParams === undefined ? 'componentParams: absent' : JSON.stringify(componentParams)}
      </code>
      <small>
        module instance <output data-testid="probe-cell-instance">{moduleInstance}</output>
      </small>
    </span>
  );
}

export const resourceCellRegistrations: ExtensionRegistration<ProbeResourceCellV1>[] = contributesCell
  ? [{
    extensionPointId: RESOURCE_CELL_EXTENSION_POINT_ID,
    registration: {
      id: 'probe-node-cell',
      label: 'Probe node cell',
      value: { contractVersion: 1, name: NODE_CELL_COMPONENT, resourceKeys: ['vm'], component: ProbeNodeCell },
    },
  }]
  : [];
