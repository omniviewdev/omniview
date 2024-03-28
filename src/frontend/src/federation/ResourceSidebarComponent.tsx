import React from 'react';

// material-ui
import Chip from '@mui/joy/Chip';
import CircularProgress from '@mui/joy/CircularProgress';
import DialogContent from '@mui/joy/DialogContent';
import Divider from '@mui/joy/Divider';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import Sheet from '@mui/joy/Sheet';
import Typography from '@mui/joy/Typography';


// project imports
import PluginComponent from '.';
import useResourceAreaComponent from '@/hooks/resource/useResourceAreaComponent';
import useResource from '@/hooks/resource/useResource';
import useResourceType from '@/hooks/resource/useResourceType';

// types
import { ui } from '@api/models';

// icons
import Icon from '@/components/icons/Icon';
import { LuX } from 'react-icons/lu';

// third-party
import { stringify } from 'yaml';
import MonacoEditor from '@monaco-editor/react';

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
      variant="soft"
      sx={{ borderRadius: 'sm' }}
      startDecorator={
        (icon !== undefined && icon !== '') ? (
          typeof icon === 'string' ? <Icon name={icon} size={16} /> : icon
        ) : null
      }
    >
      <Typography level="title-sm">{type}</Typography>
    </Chip>
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
  const { resource } = useResource({ pluginID, connectionID, resourceKey, resourceID, namespace });
  const { resourceType } = useResourceType({ pluginID, resourceKey });

  if (resource.isLoading || resourceType.isLoading) {
    return (
      <Stack height='100%' width='100%' spacing={2} direction="column" justifyContent={'center'} alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  if (!resource.data || !resourceType.data) {
    return <React.Fragment />;
  }

  return (
    <Sheet
      sx={{
        borderRadius: 'md',
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: '100%',
        overflow: 'auto',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent={'space-between'}>
        <Chip size="lg" variant="plain" sx={{ borderRadius: 'sm' }}>
          <Typography sx={{ flexGrow: 1 }}>{resourceID}</Typography>
        </Chip>
        <Stack direction="row" gap={1}>
          <ResourceDrawerDecorator icon={resourceType.data.icon} type={resourceKey} />
          <IconButton variant="outlined" size="sm" onClick={onClose}>
            <LuX size={20} />
          </IconButton>
        </Stack>
      </Stack>
      <Divider />
      <DialogContent
        sx={{
          gap: 2,
          p: 0.5,
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
        <ResourceSidebarComponent plugin={pluginID} resource={resourceKey} data={resource.data.result} />
      </DialogContent>
    </Sheet>
  );
};

type ResourceSidebarComponentProps = {
  plugin: string;
  resource: string;
  data: Record<string, unknown>;
};

/**
 * Get the dynamic resource sidebar component with the fallback
 */
const ResourceSidebarComponent: React.FC<ResourceSidebarComponentProps> = ({ plugin, resource, data }) => {
  const { component } = useResourceAreaComponent(ui.GetResourceAreaComponentInput.createFrom({ plugin, resource, area: 'SIDEBAR' }));

  if (component.isLoading) {
    return (
      <Stack height='100%' width='100%' spacing={2} direction="column" justifyContent={'center'} alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  if (component.isError || !component.data) {
    console.log('ResourceSidebarComponent', component.error);
    // render the fallback
    return (
      <MonacoEditor
        defaultLanguage='yaml'
        theme='vs-dark'
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
      data={data}
      fallback={<React.Fragment />}
    />
  );
};

export default ResourceDrawerContainer;
