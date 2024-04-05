import { type FC } from 'react';

// material-ui
import Box from '@mui/joy/Box';
import CircularProgress from '@mui/joy/CircularProgress';
import Typography from '@mui/joy/Typography';
import Alert from '@mui/joy/Alert';

// icons
import { LuAlertCircle } from 'react-icons/lu';

// Helpers
import useResourceDefinition from '@/hooks/resource/useResourceDefinition';
import { useResources } from '@/hooks/resource/useResources';
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

  const { isLoading, isError, data, columns } = useResourceDefinition({ pluginID, connectionID, resourceKey });
  const { resources } = useResources({ pluginID, connectionID, resourceKey });

  // TODO: replace these with loaders
  if (isLoading || resources.isLoading) {
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
        <CircularProgress size={'lg'} thickness={8} />
        <Typography level='title-lg'>
          Loading {resourceKey} resources...
        </Typography>
      </Box>
    );
  }

  if (isError || resources.isError) {
    let errstring = resources.error?.toString();
    console.error('Failed loading resources', errstring);
    let error = <p>{'An error occurred while loading resources'}</p>;
    if (errstring?.includes('could not find the requested resource')) {
      error = <div>
        <span>{'The resource group could not be found. This may be the result of'}</span>
        <ol>
          <li>{'The resource group does not exist (for this connection)'}</li>
          <li>{'The resource group has been deleted (for this connection)'}</li>
          <li>{'You do not have permission to access the resource group'}</li>
        </ol>
      </div>;
    }

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
      }}>
        <Alert
          variant='soft'
          size='lg'
          startDecorator={<LuAlertCircle size={20} />}
          color='danger'
        >
          <Typography level='title-lg' color='danger'>
            Failed loading {resourceKey} resources
          </Typography>
        </Alert>
        <Typography level='body-sm' color='danger' textAlign={'center'} maxWidth={500} flexWrap='wrap'>
          {error}
        </Typography>
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
    const testObjectKey = Object.keys(resources.data.result)[0];
    return wellKnownIDAccessors(resources.data.result[testObjectKey]);
  };

  return (
    <ResourceTableContainer
      columns={columns.defs}
      data={Object.values(resources.data.result)}
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
