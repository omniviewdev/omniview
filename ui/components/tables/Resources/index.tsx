import { type FC } from 'react';

// material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { Alert } from '@omniviewdev/ui/feedback';
import { Stack } from '@omniviewdev/ui/layout';

// icons
import { LuCircleAlert } from 'react-icons/lu';

// project imports
import useResourceDefinition from '@/hooks/resource/useResourceDefinition';
import { useResources } from '@omniviewdev/runtime';
import ResourceTableContainer from './ResourceTableContainer';


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
      <Box sx={{
        display: 'flex',
        gap: 4,
        justifyContent: 'center',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        userSelect: 'none',
        animation: 'fadeIn 0.2s ease-in-out',
        '@keyframes fadeIn': {
          '0%': {
            opacity: 0,
            scale: 0.3,
          },
          '100%': {
            opacity: 1,
            scale: 1,
          },
        },
      }}>
        <CircularProgress size={40} thickness={8} />
        <Text weight="semibold" size="lg">
          Loading {resourceKey} resources...
        </Text>
      </Box>
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
      <Box sx={{
        display: 'flex',
        gap: 2,
        justifyContent: 'center',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        userSelect: 'none',
      }}>
        <Alert
          emphasis='soft'
          size='lg'
          startAdornment={<LuCircleAlert size={20} />}
          color='danger'
        >
          <Heading level="h4" sx={{ color: 'danger.main' }}>
            {title}
          </Heading>
        </Alert>
        <Stack direction="column" spacing={1} sx={{ maxWidth: 560, textAlign: 'center' }}>
          <Text size='sm' sx={{ color: 'text.secondary' }}>
            {detail}
          </Text>
          {suggestions.length > 0 && (
            <Box component="ul" sx={{ textAlign: 'left', pl: 2, m: 0 }}>
              {suggestions.map((s) => (
                <Box component="li" key={s} sx={{ py: 0.25 }}>
                  <Text size='xs' sx={{ color: 'text.secondary' }}>{s}</Text>
                </Box>
              ))}
            </Box>
          )}
          <Text
            size='xs'
            sx={{
              color: 'text.disabled',
              fontFamily: 'monospace',
              mt: 1,
              p: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              wordBreak: 'break-all',
              maxHeight: 80,
              overflow: 'auto',
            }}
          >
            {resourceKey}: {errstring || 'Unknown error'}
          </Text>
        </Stack>
      </Box>
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
