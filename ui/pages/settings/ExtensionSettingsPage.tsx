import React from 'react';
import { useExtensionRegistry } from '@omniviewdev/runtime/extensions/provider';
import { Stack, List, ListItem, ListItemButton, ListItemContent, Typography, Sheet, useTheme, Box, Card, CardContent, Chip } from '@mui/joy';
import { useMediaQuery } from '@mui/material';
import Icon from '@/components/icons/Icon';
import { type ExtensionRegistrySettings, type ExtensionRegistryStore } from '@omniviewdev/runtime/extensions/store';

const ExtensionSettingsPage: React.FC = () => {
  const theme = useTheme();
  const extensions = useExtensionRegistry();
  const isNormalScreenSize = useMediaQuery(theme.breakpoints.up('lg'));

  const [selected, setSelected] = React.useState<ExtensionRegistryStore<any> | undefined>(undefined);
  const [selectedSettings, setSelectedSettings] = React.useState<ExtensionRegistrySettings | undefined>(undefined);

  const selectExtensionPoint = (id: string) => {
    const extension = extensions?.extensionPointRegistry.getExtensionPoint(id);

    if (extension) {
      setSelected(extension);
      setSelectedSettings(extension.settings());
    }
  };

  return (
    <Stack
      direction={'column'}
      gap={2}
      sx={{
        width: '100%',
        maxWidth: '100%',
        height: '100%',
        maxHeight: '100%',
      }}
    >
      <Sheet
        variant='outlined'
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 12,
          width: '100%',
          padding: 2,
          gap: 1.5,
        }}
      >
        <Icon name={'LuBrainCircuit'} size={isNormalScreenSize ? 20 : 30} />
        <Stack
          sx={{
            display: 'flex',
            flexDirection: {
              xs: 'column',
              lg: 'row',
            },
            justifyContent: {
              xs: 'flex-start',
              lg: 'space-between',
            },
            alignItems: {
              xs: 'flex-start',
              lg: 'center',
            },
            borderRadius: 12,
            width: '100%',
          }}
        >
          <Typography level={isNormalScreenSize ? 'title-lg' : 'title-md'}>
            Extension
          </Typography>
          <Typography level={isNormalScreenSize ? 'body-sm' : 'body-xs'}>
            View and manage the installed extensions in the IDE
          </Typography>
        </Stack>
      </Sheet>

      {/* Render the settings section here */}
      <Box
        sx={{
          width: '100%',
          overflow: 'auto',
          display: 'flex',
          flexGrow: 1,
          gap: 2,
        }}
      >

        <Card 
          variant='outlined'
          sx={{ p: 0.5 }}
        >
          <CardContent>
            <Stack spacing={0} direction={'column'}>
              <Typography p={1}level={'h4'}>Extension Points</Typography>
              <List 
                variant={'soft'}
                size={'sm'} 
                sx={{ width: 350, borderRadius: 8 }}
              >
                {extensions?.extensionPointRegistry.listExtensionPoints().map((extension) => (
                  <>
                    <ListItem>
                      <ListItemButton 
                        selected={selected?.settings().id === extension.id}
                        onClick={() => {
                          selectExtensionPoint(extension.id); 
                        }}
                      >
                        <ListItemContent>
                          {extension.id}
                        </ListItemContent>
                      </ListItemButton>
                    </ListItem>
                  </>
                ))}
              </List>
            </Stack>
          </CardContent>
        </Card>

        {selected && (
          <Box
            sx={{
              backgroundColor: theme.palette.background.popup,
              width: '100%',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
            }}
          >

            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" gap={2} justifyContent={'space-between'}>
                  <Typography 
                    level="title-md"
                    endDecorator={
                      <Chip variant={'outlined'} sx={{ borderRadius: 'sm', ml: 1 }}>
                        {selectedSettings?.mode} display
                      </Chip>
                    }
                  >
                    {selectedSettings?.name}
                  </Typography>
                  {selectedSettings?.mode && 
                  <Chip color={'primary'} sx={{ borderRadius: 'sm' }}>
                    {selectedSettings?.id}
                  </Chip>
                  }
                </Stack>
                <Stack direction="row" gap={2} justifyContent={'space-between'}>
                  <Typography>{selectedSettings?.description}</Typography>
                </Stack>
              </CardContent>
            </Card>
            <ExtensionPointDisplay extensionPoint={selected} />
          </Box>
        )}
      </Box>
    </Stack>
  );
};

type ExtensionPointDisplayProps = {
  extensionPoint: ExtensionRegistryStore<any>;
};

const ExtensionPointDisplay: React.FC<ExtensionPointDisplayProps> = ({ extensionPoint }) => {
  const registrations = extensionPoint.list();

  if (!registrations?.length) {
    return (
      <Box sx={{ height: '100%', width: '100%', textAlign: 'center', alignContent: 'center' }}>
        <Typography>No extensions have been registered for this extension point</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        gap: 2,
      }}
    >
    </Box>
  );

};

export default ExtensionSettingsPage;
