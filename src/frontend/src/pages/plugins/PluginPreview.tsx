import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import Tab, { tabClasses } from '@mui/joy/Tab';
import { Avatar, Stack, Typography } from '@mui/joy';
import React, { FC } from 'react';
import { InstallDesktop } from '@mui/icons-material';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { Chip } from '@mui/joy';

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
    <Stack direction="column" p={6} gap={3} maxHeight={'100%'}>
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
      </Tabs>
      <Box overflow={'auto'} p={1}>
        {plugin.readme
          ? _readme && <MarkdownPreview source={_readme} style={{ backgroundColor: 'transparent' }} />
          : <Typography level="body-xs">No details available</Typography>
        }
      </Box>
    </Stack >
  );
}

export default PluginDetails;
