import { jsonToValue, type ColumnDefinition, type HostRecord } from '@omniviewdev/runtime';

/**
 * A generic enumerable resource type for exercising the resource table, with nothing from any
 * provider in it. Every value derives from the record's index, so repeated runs see identical data.
 */
export const FIXTURE_RESOURCE_TYPE = 'widgets';

export const FIXTURE_CONNECTION_ID = 'fixture-connection';

const PHASES = ['Running', 'Pending', 'Failed', 'Succeeded'];

/**
 * One host record shaped like a provider's source-view record. `overrides` replaces body fields, which
 * models a patch: the same key and address with a changed body, as a new immutable record object.
 */
export function makeHostRecord(index: number, overrides: Record<string, unknown> = {}): HostRecord {
  const id = `widget-${String(index).padStart(5, '0')}`;
  const address = { provider: 'fixture', authority: 'fixture', type: FIXTURE_RESOURCE_TYPE, id, scope: [] };
  const incarnation = `uid-${index}`;

  return {
    key: JSON.stringify([address, incarnation]),
    addressKey: JSON.stringify(address),
    targetId: 'fixture-target',
    route: { connection: FIXTURE_CONNECTION_ID },
    record: {
      reference: { address, incarnation },
      body: jsonToValue({ name: id, phase: PHASES[index % PHASES.length], size: index, ...overrides }),
      representation: { id: 'json', revision: '1' },
      coverage: { kind: 'complete', paths: [] },
    },
  };
}

export function makeHostRecords(count: number): HostRecord[] {
  return Array.from({ length: count }, (_, index) => makeHostRecord(index));
}

/** What a provider declares for the fixture type: text, a colored status, a fixed-width number and a hidden column. */
export const FIXTURE_COLUMN_DEFS: readonly ColumnDefinition[] = [
  { id: 'name', header: 'Name', accessor: 'name' },
  { id: 'phase', header: 'Phase', accessor: 'phase', colorMap: { Running: 'success', Failed: 'danger' } },
  { id: 'size', header: 'Size', accessor: 'size', align: 'RIGHT', width: 80 },
  { id: 'owner', header: 'Owner', accessor: 'owner', hidden: true },
];
