import React, { type FC } from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
import { Avatar, Chip } from '@omniviewdev/ui';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';

// mock
import mock from './mock/plugins.json';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import PluginChangelog from './sections/PluginChangelog';
import { useNavigate, useParams } from 'react-router-dom';
import { LuChevronLeft } from 'react-icons/lu';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import PluginUpdateButton from './PluginUpdateButton';

const PluginDetails: FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const plugin = mock.find((plugin) => plugin.id === id)
  const [_readme, setReadme] = React.useState('');
  const navigate = useNavigate()
  const { plugins } = usePluginManager();

  const installed = plugins.data?.find((p => p.id == id))

  React.useEffect(() => {
    setReadme('');
    if (plugin?.readme) {
      fetch(plugin.readme)
        .then(async response => response.text())
        .then(text => {
          setReadme(text);
        });
    }
  }, [plugin]);

  if (!plugin) {
    return (
      <></>
    )
  }

  return (
    <Stack direction='column' px={3} pb={3} pt={2} gap={3} sx={{ maxHeight: 'calc(100vh - 60px)' }}>
      <Stack direction={'row'} spacing={1} width={'100%'} alignItems={'center'}>
        <Button
          color="neutral"
          startAdornment={<LuChevronLeft />}
          onClick={() => navigate('/plugins')}
          emphasis="soft"
        >
          {'Back to Installed Plugins'}
        </Button>
      </Stack>

      <Stack direction='row' spacing={3} width={'100%'} alignItems={'center'} >
        <Avatar sx={{ height: 72, width: 72, borderRadius: 2 }} src={plugin.icon} />
        <Stack direction='column' spacing={0.5} justifyContent={'center'} width={'100%'} >
          <Stack direction='row' spacing={2} alignItems='center' >
            <Heading level={3}>{plugin.name}</Heading>
            <Chip size='sm' sx={{ borderRadius: 1, maxHeight: 20 }} color='primary' label={plugin.version} />
          </Stack>
          <Text size='xs'>{plugin.description}</Text>
        </Stack>
        <Box height={'100%'} >
          <PluginUpdateButton pluginID={id} installed={!!installed} currentVersion={installed?.metadata.version || ''} />
        </Box>
      </Stack>

      <Tabs aria-label='tabs' defaultValue={0}>
        <TabPanel value={0} label='Details' sx={{ display: 'flex', p: 0 }}>
          <Box overflow={'auto'} p={0}>
            {plugin.readme
              ? _readme && <MarkdownPreview source={_readme} style={{ backgroundColor: 'transparent', overflow: 'auto', maxHeight: 'calc(100vh - 350px)' }} />
              : <Text size='xs'>No details available</Text>
            }
          </Box>
        </TabPanel>
        <TabPanel value={1} label='Content'>
          <Box overflow={'auto'} p={1}>
            <Text size='xs'>No content available</Text>
          </Box>
        </TabPanel>
        <TabPanel value={2} label='Reviews'>
          <Box overflow={'auto'} p={1}>
            <Text size='xs'>No reviews available</Text>
          </Box>
        </TabPanel>
        <TabPanel value={3} label='Changelog'>
          <Box overflow={'scroll'} p={1} maxHeight={'100%'}>
            <PluginChangelog id={plugin.id} />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack >
  );
};

export default PluginDetails;
