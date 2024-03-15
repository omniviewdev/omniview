import React, { FC } from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import TabPanel from '@mui/joy/TabPanel';
import Tab, { tabClasses } from '@mui/joy/Tab';
import { Avatar, Stack, Typography } from '@mui/joy';
import { InstallDesktop } from '@mui/icons-material';

// third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import PluginChangelog from './sections/PluginChangelog';

type Props = {
  plugin: any;
}

const PluginDetails: FC<Props> = ({ plugin }) => {
  const [_readme, setReadme] = React.useState('')

  React.useEffect(() => {
    setReadme('')
    if (plugin.readme) {
      fetch(plugin.readme)
        .then((response) => response.text())
        .then((text) => setReadme(text))
    }
  }, [plugin])

  return (
    <Stack direction="column" p={6} gap={3} sx={{ maxHeight: 'calc(100vh - 200px)' }}>
      <Stack direction="row" spacing={3} width={'100%'} alignItems={'center'} >
        <Avatar sx={{ height: 72, width: 72, borderRadius: 'md' }} variant='plain' src={plugin.icon} />
        <Stack direction="column" spacing={0.5} justifyContent={'center'} width={'100%'} >
          <Stack direction="row" spacing={2} alignItems="center" >
            <Typography level="h3">{plugin.name}</Typography>
            <Chip size="sm" sx={{ borderRadius: 'sm', maxHeight: 20 }} color="primary">{plugin.version}</Chip>
          </Stack>
          <Typography level="body-xs">{plugin.description}</Typography>
        </Stack>
        <Box height={'100%'} >
          <Button size="lg" variant="outlined" color="primary" startDecorator={<InstallDesktop />}>Install</Button>
        </Box>
      </Stack>
      <Tabs aria-label="tabs" defaultValue={0} sx={{ bgcolor: 'transparent' }}>
        <TabList
          disableUnderline
          variant='outlined'
          sx={{
            p: 1,
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
        <TabPanel value={0} sx={{ display: 'flex' }}>
          <Box overflow={'auto'} p={1}>
            {plugin.readme
              ? _readme && <MarkdownPreview source={_readme} style={{ backgroundColor: 'transparent' }} />
              : <Typography level="body-xs">No details available</Typography>
            }
          </Box>
        </TabPanel>
        <TabPanel value={1}>
          <Box overflow={'auto'} p={1}>
            <Typography level="body-xs">No content available</Typography>
          </Box>
        </TabPanel>
        <TabPanel value={2}>
          <Box overflow={'auto'} p={1}>
            <Typography level="body-xs">No reviews available</Typography>
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
}

export default PluginDetails;
