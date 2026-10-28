import { type FC, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ResourceClient } from '@omniviewdev/runtime/api';

import { Banner, Button, Heading, Spinner, Stack, Text } from '@omniviewdev/base-ui';

// icons
import { LuCircleAlert } from 'react-icons/lu';

// project imports
import useResourceDefinition from '@/hooks/resource/useResourceDefinition';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';
import { useResources, useResourceType, useResolvedResourceTarget, valueToJSON, valueToJSONText, parseAppError, type QueryScope } from '@omniviewdev/runtime';
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
};


/**
 * Display a table of the deployments
 */
const ResourceTable: FC<Props> = ({ pluginID, connectionID, resourceKey }) => {

  const [representation, setRepresentation] = useState('');
  const [paging, setPaging] = useState<{ context: string; cursors: Array<string | undefined> }>({ context: '', cursors: [undefined] });
  const [scope, setScope] = useState<QueryScope>([]);
  const { resourceType } = useResourceType({ pluginID, route: { connection: connectionID }, type: resourceKey });
  const selectedRepresentation = representation || resourceType.data?.defaultRepresentation || '';
  const canEnumerate = resourceType.data?.capabilities.some((item) => item.operation === 'enumerate') ?? false;
  const canGet = resourceType.data?.capabilities.some((item) => item.operation === 'get') ?? false;
  const [lookupID, setLookupID] = useState('');
  const [readID, setReadID] = useState('');
  const [identityScope, setIdentityScope] = useState<Record<string, string>>({});
  const target = useResolvedResourceTarget({
    pluginID,
    route: { connection: connectionID },
    type: resourceKey,
    scope,
    representation: selectedRepresentation,
    enabled: canEnumerate && selectedRepresentation !== '',
  });
  const { isLoading, isError, error: definitionError, columns } = useResourceDefinition({ pluginID, connectionID, resourceKey });
  const pageContext = JSON.stringify([pluginID, connectionID, resourceKey, scope, selectedRepresentation, target.data?.targetId]);
  const cursors = paging.context === pageContext ? paging.cursors : [undefined];
  const cursor = cursors[cursors.length - 1];
  const setCursors = (update: Array<string | undefined> | ((pages: Array<string | undefined>) => Array<string | undefined>)) =>
    setPaging({ context: pageContext, cursors: typeof update === 'function' ? update(cursors) : update });
  const lookup = useQuery({
    queryKey: [pluginID, 'resource-table-get', pageContext, readID, identityScope],
    enabled: canGet && readID !== '' && selectedRepresentation !== '',
    retry: false,
    queryFn: async () => {
      const resolved = await ResourceClient.ResolveReference(pluginID, {
        route: { connection: connectionID }, type: resourceKey, id: readID,
        scope: (resourceType.data?.identityDimensions ?? []).map(({ name }) => ({ dimension: name, value: identityScope[name] ?? '' })),
        representation: selectedRepresentation,
      });
      return ResourceClient.Get(pluginID, { targetId: resolved.targetId, request: {
        route: resolved.route, reference: resolved.reference, representation: resolved.representation,
      } });
    },
  });
  const { resources } = useResources({
    pluginID,
    request: target.data ? { targetId: target.data.targetId, request: { target: target.data.target, pageSize: 1000, cursor } } : undefined,
    enabled: canEnumerate,
    live: false,
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
  </Stack>;

  if (resourceType.data && !canEnumerate && !canGet && !(isError && presentationFailure)) {
    return <Text>{resourceType.data.displayName || resourceKey}: Catalog only. No enumerate or get operation is advertised.</Text>;
  }
  if (!selectedRepresentation && !(isError && presentationFailure) && !resourceType.isError) {
    return (
      <Stack direction="column" spacing={2}>
        <Text>Select a representation for {resourceKey}.</Text>
        <select aria-label="Resource representation" value={representation} onChange={(event) => setRepresentation(event.target.value)}>
          <option value="">Select representation</option>
          {resourceType.data?.representations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
        {resourceType.isError && <Text tone="danger">{String(resourceType.error)}</Text>}
      </Stack>
    );
  }

  if (isLoading || (canEnumerate && (target.isLoading || resources.isLoading))) {
    return (
      <div className={styles.Loading}>
        <Spinner size='xl' />
        <Text weight="semibold" size="lg">
          Loading {resourceKey} resources...
        </Text>
      </div>
    );
  }

  if (resourceType.isError || target.isError || resources.isError || (isError && presentationFailure)) {
    const errstring = parseAppError(resources.error ?? target.error ?? resourceType.error ?? definitionError).detail;
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
  if (!canEnumerate) {
    return <Stack direction="column" spacing={2}>
      <Text>{resourceType.data?.displayName || resourceKey}: {canGet ? 'Look up a resource by its canonical ID and identity scope.' : 'Catalog only. No enumerate or get operation is advertised.'}</Text>
      {canGet && <>
        <input aria-label="Resource ID" value={lookupID} onChange={(event) => setLookupID(event.target.value)} />
        {resourceType.data?.identityDimensions.map(({ name }) => <label key={name}>{name}<input aria-label={`Identity scope ${name}`} value={identityScope[name] ?? ''} onChange={(event) => { setReadID(''); setIdentityScope((current) => ({ ...current, [name]: event.target.value })); }} /></label>)}
        <Button onClick={() => setReadID(lookupID)}>Get resource</Button>
        {lookup.isFetching && <Spinner />}
        {lookup.isError && <Text tone="danger">{parseAppError(lookup.error).detail}</Text>}
        {lookup.data && <pre>{valueToJSONText(lookup.data.record.body)}</pre>}
      </>}
    </Stack>;
  }
  if (!listResult) return null;


  return (
    <Stack direction="column" spacing={2}>
      <Stack direction="row" spacing={2}>
        <select aria-label="Resource representation" value={selectedRepresentation} onChange={(event) => {
          setRepresentation(event.target.value);
          setCursors([undefined]);
        }}>
          {resourceType.data?.representations.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
        </select>
        {resourceType.data?.queryDimensions.map((dimension) => (
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

export default ResourceTable;
