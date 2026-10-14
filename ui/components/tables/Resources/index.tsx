import { type FC } from 'react';

import { Banner, Heading, Spinner, Stack, Text } from '@omniviewdev/base-ui';

// icons
import { LuCircleAlert } from 'react-icons/lu';

// project imports
import useResourceDefinition from '@/hooks/resource/useResourceDefinition';
import { useResources } from '@omniviewdev/runtime';
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
 * if for some reasong the plugin developer hasn't supplied an id accessor, attempt to fix it for them
 */
const wellKnownIDAccessors = (data: any) => {
  if (data.id) {
    return 'id';
  }

  if (data.Id) {
    return 'Id';
  }

  if (data.metadata?.name) {
    return 'metadata.name';
  }

  if (data.metadata?.uid) {
    return 'metadata.uid';
  }

  if (data.metadata?.id) {
    return 'metadata.id';
  }

  if (data.id) {
    return 'id';
  }

  throw new Error('No ID accessor found, and no well known ID accessors found');
};

/**
 * Display a table of the deployments
 */
const ResourceTable: FC<Props> = ({ pluginID, connectionID, resourceKey }) => {
  if (!pluginID || !connectionID || !resourceKey) {
    return null;
  }

  const { isLoading, isError, data, columns, namespaces } = useResourceDefinition({ pluginID, connectionID, resourceKey });
  const { resources } = useResources({ pluginID, connectionID, resourceKey });

  // TODO: replace these with loaders
  if (isLoading || resources.isLoading || namespaces.isLoading) {
    console.log('Loading resources...');
    return (
      <div className={styles.Loading}>
        <Spinner size='xl' />
        <Text weight="semibold" size="lg">
          Loading {resourceKey} resources...
        </Text>
      </div>
    );
  }

  if (isError || resources.isError) {
    const errstring = typeof resources.error === 'string'
      ? resources.error
      : resources.error?.toString() ?? '';
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

  if (!resources.data || !data || !columns.defs.length) {
    return null;
  }

  /**
   * if for some reasong the plugin developer hasn't supplied an id accessor, attempt to fix it for them
   * @returns {string} the id accessor
   * @throws {Error} if no id accessor is found and no well known id accessors are found in the first object
   */
  const getIDAccessor = (): string => {
    if (data.id_accessor) {
      return data.id_accessor;
    }

    // attempt to find a well known id accessor
    return wellKnownIDAccessors(resources.data.result[0]);
  };

  return (
    <ResourceTableContainer
      columns={columns.defs}
      data={Object.values(resources.data.result)}
      namespaces={namespaces.data ?? []}
      idAccessor={getIDAccessor()}
      namespaceAccessor={data.namespace_accessor}
      memoizer={data.memoizer_accessor}
      pluginID={pluginID}
      connectionID={connectionID}
      resourceKey={resourceKey}
      initialColumnVisibility={columns.visibility}
    />
  );
};

export default ResourceTable;
