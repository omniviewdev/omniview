import { type FC, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { Banner, Button, Heading, Spinner, Stack, Text } from '@omniviewdev/base-ui';

// icons
import { LuCircleAlert } from 'react-icons/lu';

// project imports
import useResourceDefinition from '@/hooks/resource/useResourceDefinition';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';
import { useResources, useResolvedResourceTarget, valueToJSON, valueToJSONText, parseAppError, type QueryScope, type ResourceType } from '@omniviewdev/runtime';
import ResourceTableContainer from './ResourceTableContainer';
import styles from './index.module.css';


type Props = {
  /**
   * The plugin ID
   */
  pluginID: string;
  /**
   * The connection ID
   */
  connectionID: string;
  /**
   * The resource key that uniquely identifies the resource
   */
  resourceKey: string;
  resourceType: ResourceType;
};


/**
 * Display an enumerable resource type and its source pages.
 */
const EnumerableResourceTable: FC<Props> = ({ pluginID, connectionID, resourceKey, resourceType }) => {

  const [representation, setRepresentation] = useState('');
  const [paging, setPaging] = useState<{ context: string; cursors: Array<string | undefined> }>({ context: '', cursors: [undefined] });
  const [scope, setScope] = useState<QueryScope>([]);
  const selectedRepresentation = representation || resourceType.defaultRepresentation || '';
  const target = useResolvedResourceTarget({
    pluginID,
    route: { connection: connectionID },
    type: resourceKey,
    scope,
    representation: selectedRepresentation,
    enabled: selectedRepresentation !== '',
  });
  const { isLoading, isError, error: definitionError, columns } = useResourceDefinition({ pluginID, connectionID, resourceKey });
  // A source cursor belongs to the complete acquisition context, including the
  // resolved target generation. Never carry it across a context change.
  const pageContext = JSON.stringify([pluginID, connectionID, resourceKey, scope, selectedRepresentation, target.data?.targetId]);
  const cursors = paging.context === pageContext ? paging.cursors : [undefined];
  const cursor = cursors[cursors.length - 1];
  const setCursors = (update: Array<string | undefined> | ((pages: Array<string | undefined>) => Array<string | undefined>)) =>
    setPaging({ context: pageContext, cursors: typeof update === 'function' ? update(cursors) : update });
  const { resources, membershipStale, isAcquiredRequestCurrent } = useResources({
    pluginID,
    request: target.data ? { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 1000, cursor } } : undefined,
    enabled: true,
    live: true,
  });
  const rows = useMemo(() => resources.data?.records.map((record) => ({
    record,
    data: valueToJSON(record.record.body),
  })) ?? [], [resources.data]);
  const genericColumns: Array<ColumnDef<ResourceTableRow>> = [
    { id: 'id', header: 'ID', accessorFn: (row) => row.record.record.reference.address.id },
    { id: 'scope', header: 'Scope', accessorFn: (row) => row.record.record.reference.address.scope.map((entry: { dimension: string; value: string }) => `${entry.dimension}=${entry.value}`).join(', ') },
    { id: 'body', header: 'Raw body', accessorFn: (row) => valueToJSONText(row.record.record.body) },
  ];
  const presentationFailure = parseAppError(definitionError).code !== 'UNSUPPORTED';
  const controls = <Stack direction="row" spacing={2}>
    <Button size="sm" disabled={cursors.length === 1} onClick={() => setCursors((pages) => pages.slice(0, -1))}>Previous page</Button>
    <Text>Source page {cursors.length}</Text>
    <Button size="sm" disabled={resources.isFetching} onClick={() => { void resources.refetch(); }}>Refresh source page</Button>
  </Stack>;

  if (!selectedRepresentation && !(isError && presentationFailure)) {
    return (
      <Stack direction="column" spacing={2}>
        <Text>Select a representation for {resourceKey}.</Text>
        <select aria-label="Resource representation" value={representation} onChange={(event) => setRepresentation(event.target.value)}>
          <option value="">Select representation</option>
          {resourceType.representations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
      </Stack>
    );
  }

  if (isLoading || target.isLoading || resources.isLoading) {
    return (
      <div className={styles.Loading}>
        <Spinner size='xl' />
        <Text weight="semibold" size="lg">
          Loading {resourceKey} resources...
        </Text>
      </div>
    );
  }

  if (target.isError || resources.isError || (isError && presentationFailure)) {
    const errstring = parseAppError(resources.error ?? target.error ?? definitionError).detail;
    console.error('Failed loading resources', errstring);

    // Try to parse structured error JSON from the plugin (ResourceOperationError.Error()
    // returns JSON that survives the Wails boundary).
    let title = 'Failed to load resources';
    let detail = errstring;
    let suggestions: string[] = [];

    try {
      const parsed = JSON.parse(errstring);
      if (parsed && typeof parsed.code === 'string' && typeof parsed.title === 'string') {
        title = parsed.title;
        detail = parsed.message ?? errstring;
        suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      }
    } catch {
      // Not JSON — use raw string as detail (fallback for unstructured errors).
    }

    return (
      <div className={styles.Error}>
        {controls}
        <Banner variant='soft' size='lg' color='danger'>
          <Banner.Icon>
            <LuCircleAlert size={20} />
          </Banner.Icon>
          <Banner.Content>
            <Heading level={4} tone='danger'>
              {title}
            </Heading>
          </Banner.Content>
        </Banner>
        <Stack direction="column" spacing={2} className={styles.ErrorDetails}>
          <Text size='sm' tone='muted'>
            {detail}
          </Text>
          {suggestions.length > 0 && (
            <ul className={styles.Suggestions}>
              {suggestions.map((s) => (
                <li key={s} className={styles.Suggestion}>
                  <Text size='xs' tone='muted'>{s}</Text>
                </li>
              ))}
            </ul>
          )}
          <Text size='xs' tone='subtle' className={styles.RawError}>
            {resourceKey}: {errstring || 'Unknown error'}
          </Text>
        </Stack>
      </div>
    );
  }

  const listResult = resources.data;
  if (!listResult) return null;


  return (
    <Stack direction="column" spacing={2}>
      <Stack direction="row" spacing={2}>
        <select aria-label="Resource representation" value={selectedRepresentation} onChange={(event) => {
          setRepresentation(event.target.value);
          setCursors([undefined]);
        }}>
          {resourceType.representations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
        {resourceType.queryDimensions.map((dimension) => (
          <label key={dimension.name}>
            {dimension.name}
            <input
              aria-label={`Filter scope ${dimension.name}`}
              placeholder="Any"
              defaultValue={scope.flatMap((entry) => entry.dimension === dimension.name && entry.match === 'oneOf' ? entry.values : [])[0] ?? ''}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                setScope((current) => [
                  ...current.filter((entry) => entry.dimension !== dimension.name),
                  ...(value ? [{ dimension: dimension.name, match: 'oneOf' as const, values: [value] }] : []),
                ]);
                setCursors([undefined]);
              }}
            />
          </label>
        ))}
        {controls}
        <Button size="sm" disabled={!listResult.sourcePage.nextCursor} onClick={() => {
          const next = listResult.sourcePage.nextCursor;
          if (next) setCursors((pages) => [...pages, next]);
        }}>Next page</Button>
      </Stack>
      {isAcquiredRequestCurrent && membershipStale && <Text tone="muted">Source membership may have changed. Visible-row updates are best effort; refresh this source page to reacquire its membership.</Text>}
      <ResourceTableContainer
        columns={columns.defs.length ? columns.defs : genericColumns}
        data={rows}
        pluginID={pluginID}
        connectionID={connectionID}
        resourceKey={resourceKey}
        initialColumnVisibility={columns.visibility}
      />
    </Stack>
  );
};

export default EnumerableResourceTable;
