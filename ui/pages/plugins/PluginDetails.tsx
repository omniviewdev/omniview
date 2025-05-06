import React, { type FC } from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import TabPanel from '@mui/joy/TabPanel';
import Tab, { tabClasses } from '@mui/joy/Tab';
import { Avatar, Stack, Typography } from '@mui/joy';
import { InstallDesktop } from '@mui/icons-material';

// mock
import mock from './mock/plugins.json';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import PluginChangelog from './sections/PluginChangelog';
import { useNavigate, useParams } from 'react-router-dom';
import { LuChevronLeft } from 'react-icons/lu';

const PluginDetails: FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const plugin = mock.find((plugin) => plugin.id === id)
  const [_readme, setReadme] = React.useState('');
  const navigate = useNavigate()

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
          startDecorator={<LuChevronLeft />}
          onClick={() => navigate('/plugins')}
          variant="soft"
        >
          {'Back to Installed Plugins'}
        </Button>
      </Stack>

      <Stack direction='row' spacing={3} width={'100%'} alignItems={'center'} >
        <Avatar sx={{ height: 72, width: 72, borderRadius: 'md' }} variant='plain' src={plugin.icon} />
        <Stack direction='column' spacing={0.5} justifyContent={'center'} width={'100%'} >
          <Stack direction='row' spacing={2} alignItems='center' >
            <Typography level='h3'>{plugin.name}</Typography>
            <Chip size='sm' sx={{ borderRadius: 'sm', maxHeight: 20 }} color='primary'>{plugin.version}</Chip>
          </Stack>
          <Typography level='body-xs'>{plugin.description}</Typography>
        </Stack>
        <Box height={'100%'} >
          <Button size='lg' variant='outlined' color='primary' startDecorator={<InstallDesktop />}>Install</Button>
        </Box>
      </Stack>

      <Tabs aria-label='tabs' size='sm' defaultValue={0} sx={{ bgcolor: 'transparent', gap: 2 }}>
        <TabList
          disableUnderline
          variant='outlined'
          sx={{
            p: 0.5,
            gap: 0.5,
            borderRadius: 'md',

            bgcolor: 'background.surface',
            [`& .${tabClasses.root}[aria-selected="true"]`]: {
              boxShadow: 'sm',
              bgcolor: 'background.level1',
            },
          }}
        >
          <Tab disableIndicator>Details</Tab>
          <Tab disableIndicator>Content</Tab>
          <Tab disableIndicator>Reviews</Tab>
          <Tab disableIndicator>Changelog</Tab>
        </TabList>
        <TabPanel value={0} sx={{ display: 'flex', p: 0 }}>
          <Box overflow={'auto'} p={0}>
            {plugin.readme
              ? _readme && <MarkdownPreview source={_readme} style={{ backgroundColor: 'transparent', overflow: 'auto', maxHeight: 'calc(100vh - 350px)' }} />
              : <Typography level='body-xs'>No details available</Typography>
            }
          </Box>
        </TabPanel>
        <TabPanel value={1}>
          <Box overflow={'auto'} p={1}>
            <Typography level='body-xs'>No content available</Typography>
          </Box>
        </TabPanel>
        <TabPanel value={2}>
          <Box overflow={'auto'} p={1}>
            <Typography level='body-xs'>No reviews available</Typography>
          </Box>
        </TabPanel>
        <TabPanel value={3}>
          <Box overflow={'scroll'} p={1} maxHeight={'100%'}>
            <PluginChangelog id={plugin.id} />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack >
  );
};

export default PluginDetails;
