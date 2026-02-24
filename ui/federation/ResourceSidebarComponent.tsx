import React from 'react';

// material-ui
import { Chip } from '@omniviewdev/ui';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import { IconButton, Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';


// project imports
import PluginComponent from '.';
import {
  useResourceAreaComponent,
  useResource,
  useResourceType,
  useResourceSearch,
  useSnackbar,
} from '@omniviewdev/runtime'

// types
import { types, ui } from '@omniviewdev/runtime/models';

// icons
import Icon from '@/components/icons/Icon';
import { LuFileCode, LuFileDiff, LuList, LuPencil, LuRotateCw, LuX } from 'react-icons/lu';

// third-party
import { parse, stringify } from 'yaml';
import MonacoEditor, { DiffEditor } from '@monaco-editor/react';

type Props = {
  pluginID: string;
  connectionID: string;
  resourceKey: string;
  resourceID: string;
  namespace: string;
  onClose: () => void;
};

const ResourceDrawerDecorator: React.FC<{
  icon?: string | React.ReactNode;
  type: string;
}> = ({ icon, type }) => {
  return (
    <Chip
      size="lg"
      emphasis="soft"
      sx={{ borderRadius: 'sm' }}
      icon={
        (icon !== undefined && icon !== '') ? (
          typeof icon === 'string' ? <Icon name={icon} size={16} /> : icon
        ) : undefined
      }
      label={<Text weight="semibold" size="sm">{type}</Text>}
    />
  );
};

const ResourceDrawerContainer: React.FC<Props> = ({
  pluginID,
  connectionID,
  resourceKey,
  resourceID,
  namespace,
  onClose,
}) => {
  const [view, setView] = React.useState<string>('view');

  const { resource, update } = useResource({ pluginID, connectionID, resourceKey, resourceID, namespace });
  const { resourceType } = useResourceType({ pluginID, resourceKey });

  /**
  * Update the resource
  */
  const onResourceUpdate = async (data: Record<string, unknown>) => {
    const input = types.UpdateInput.createFrom({
      input: data,
      params: {},
      id: resourceID,
      namespace: namespace,
    });
    try {
      const result = await update(input);
      console.log(result);
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      console.log('done');
    }
  };

  /**
  * Cancel the resource update
  */
  const onResourceCancel = () => {
    onClose();
  };

  if (resource.isLoading || resourceType.isLoading) {
    return (
      <Stack sx={{ height: '100%', width: '100%' }} gap={2} direction="column" justify="center" align="center">
        <CircularProgress />
      </Stack>
    );
  }

  if (!resource.data) {
    return <React.Fragment />;
  }

  return (
    <Box
      sx={{
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        maxHeight: '100%',
        overflow: 'auto',
        bgcolor: 'background.paper',
      }}
    >
      <Stack sx={{ px: 0.5, py: 0.25 }} direction="row" align="center" justify="between">
        <Text weight="semibold" size="sm" noWrap sx={{ flexGrow: 0, pl: 0.5 }}>{resourceID}</Text>
        <Stack direction="row" gap={0.5} align="center">
          <Box sx={{ display: 'flex', gap: 0 }}>
            <IconButton
              emphasis={view === 'view' ? 'soft' : 'ghost'}
              size="sm"
              onClick={() => setView('view')}
            >
              <LuList />
            </IconButton>
            <IconButton
              emphasis={view === 'edit' ? 'soft' : 'ghost'}
              size="sm"
              onClick={() => setView('edit')}
            >
              <LuPencil />
            </IconButton>
          </Box>
          <ResourceDrawerDecorator icon={resourceType.data?.icon} type={resourceKey} />
          <IconButton emphasis="outline" size="sm" onClick={onClose}>
            <LuX size={20} />
          </IconButton>
        </Stack>
      </Stack>
      <Divider />
      <Box
        sx={{
          gap: 2,
          p: 0.5,
          display: 'flex',
          flex: 1,
          overflowY: 'auto',
          maxWidth: '100%',
          overflowX: 'hidden',
          scrollbarWidth: 'none',
          // hide scrollbar
          '&::-webkit-scrollbar': {
            display: 'none',
          },
          'ms-overflow-style': 'none',
        }}
      >
        <ResourceSidebarView
          plugin={pluginID}
          connection={connectionID}
          resource={resourceKey}
          data={resource.data.result}
          view={view}
          onSubmit={onResourceUpdate}
          onCancel={onResourceCancel}
        />
      </Box>
    </Box>
  );
};


type ResourceSearch = {
  /** The resources to search through. Limited to resources within the same plugin and connection */
  searches: ResourceSearchEntry[];
};

type ResourceSearchEntry = {
  /**
   * The key of the resource
   */
  key: string;

  /**
   * The namespaces to search for the resource
   */
  namespaces: string[];

  /**
   * Post-retrieve function filter to apply after the resources are found
   */
  postFilter?: (resource: any) => boolean;
};

type ResourceSearchResult = {
  key: string;
  namespaces: string[];
  isLoading: boolean;
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/ban-types
  error: Error | null;
  data: unknown[];
};


type ResourceSidebarViewProps = {
  plugin: string;
  connection: string;
  resource: string;
  data: Record<string, unknown>;
  view: string;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
};

type ResourceEditorProps = {
  resourceKey: string;
  data: Record<string, unknown>;
  datatype: 'json' | 'yaml';
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
};

const PrepareResourceData = (data: Record<string, unknown>, datatype: 'json' | 'yaml') => {
  switch (datatype) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return stringify(data, null, 2);
  }
};

const ResourceEditor: React.FC<ResourceEditorProps> = ({ resourceKey, data, datatype, onSubmit, onCancel }) => {
  const originalData = PrepareResourceData(data, datatype);
  const editorPath = `file:///${resourceKey}/draft.yaml`;

  const [value, setValue] = React.useState<string>(originalData);
  const [changed, setChanged] = React.useState<boolean>(false);
  const [viewDiff, setViewDiff] = React.useState<boolean>(false);
  const { showSnackbar } = useSnackbar();

  const handleChange = (value: string | undefined) => {
    if (!value) {
      return;
    }

    if (!changed) {
      // a little reduntant, but try to prevent state updates where not necessary
      setChanged(true);
    }

    setValue(value);
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleSubmit = () => {
    try {
      let parsed: Record<string, unknown>;
      switch (datatype) {
        case 'json':
          parsed = JSON.parse(value);
          break;
        case 'yaml':
          parsed = parse(value);
          break;
      }

      onSubmit(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        showSnackbar({
          message: 'Invalid Resource',
          status: 'error',
          icon: 'LuCircleAlert',
          details: error.message,
        });
      }
    }
  };

  return (
    <Stack
      direction="column"
      gap={1}
      sx={{ display: 'flex', flex: 1 }}
    >
      {viewDiff ? (
        <DiffEditor
          height='100%'
          original={originalData}
          theme='vs-dark'
          modified={value}
          language={datatype}
          options={{
            readOnly: true,
            fontSize: 11,
          }}
        />
      ) : (
        <MonacoEditor
          defaultLanguage={datatype}
          theme='vs-dark'
          height='100%'
          value={value}
          language={datatype}
          path={editorPath}
          options={{
            readOnly: false,
            fontSize: 11,
          }}
          onChange={handleChange}
        />
      )}
      <Stack direction="row" justify="between" gap={1}>
        <Stack direction="row" gap={1}>
          <Button
            emphasis='soft'
            color='primary'
            disabled={!changed}
            onClick={handleSubmit}
          >Submit</Button>
          <Button
            emphasis='outline'
            color='neutral'
            onClick={handleCancel}
          >Cancel</Button>
        </Stack>
        <Stack direction="row" gap={1}>
          <Button
            emphasis='outline'
            color='warning'
            startAdornment={<LuRotateCw size={16} />}
            onClick={() => {
              setValue(originalData);
              setChanged(false);
            }}
          >Reset Changes</Button>
          <Button
            emphasis='outline'
            startAdornment={viewDiff ? <LuFileCode size={18} /> : <LuFileDiff size={16} />}
            onClick={() => {
              setViewDiff(!viewDiff);
            }}
          >{viewDiff ? 'Return to Code Editor' : 'View in Diff Editor'}</Button>
        </Stack>
      </Stack>
    </Stack>
  );
};

const ResourceSidebarView: React.FC<ResourceSidebarViewProps> = ({ plugin, connection, resource, data, view, onSubmit, onCancel }) => {
  /**
  * Provide a searchable function to the resource sidebar,
  * but limit access to the underlying behavior
  */
  const searchFunc = (options: ResourceSearch) => useResourceSearch({
    pluginID: plugin,
    connectionID: connection,
    searches: options.searches,
  }).map((result, idx) => {
    console.log('got the following:', result);
    return {
      key: options.searches[idx].key,
      namespaces: options.searches[idx].namespaces,
      data: result.data ?? [],
      isLoading: result.isLoading,
      isError: result.isError,
      error: result.error,
    };
  }) || [] as ResourceSearchResult[];

  switch (view) {
    case 'view':
      return <ResourceSidebarComponent
        plugin={plugin}
        resource={resource}
        data={data}
        onSubmit={onSubmit}
        onCancel={onCancel}
        useSearch={searchFunc}
      />;
    case 'edit':
      return <ResourceEditor
        data={data}
        datatype='yaml'
        onSubmit={onSubmit}
        onCancel={onCancel}
        resourceKey={resource}
      />;
    default:
      return <React.Fragment />;
  }
};


type ResourceSidebarComponentProps = {
  plugin: string;
  resource: string;
  data: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  useSearch: (options: ResourceSearch) => ResourceSearchResult[];
};

/**
 * Get the dynamic resource sidebar component with the fallback
 */
const ResourceSidebarComponent: React.FC<ResourceSidebarComponentProps> = ({ plugin, resource, data, onSubmit, onCancel, useSearch }) => {
  const { component } = useResourceAreaComponent(ui.GetResourceAreaComponentInput.createFrom({ plugin, resource, area: 'SIDEBAR' }));

  if (component.isLoading) {
    return (
      <Stack sx={{ height: '100%', width: '100%' }} gap={2} direction="column" justify="center" align="center">
        <CircularProgress />
      </Stack>
    );
  }

  if (component.isError || !component.data) {
    // render the fallback
    return (
      <MonacoEditor
        defaultLanguage='yaml'
        theme='vs-dark'
        height='calc(100vh - 84px)'
        value={stringify(data, null, 2)}
        options={{
          readOnly: true,
          fontSize: 11,
        }}
      />
    );
  }

  return (
    <PluginComponent
      plugin={plugin}
      component={component.data.name}
      fallback={<React.Fragment />}
      data={data}
      onSubmit={onSubmit}
      onCancel={onCancel}
      useSearch={useSearch}
    />
  );
};

export default ResourceDrawerContainer;
