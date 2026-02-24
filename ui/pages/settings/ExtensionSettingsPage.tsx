import Icon from '@/components/icons/Icon';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { useMediaQuery } from '@mui/material';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Card, Chip, List, ListItem } from '@omniviewdev/ui';
import { useExtensionRegistry, type ExtensionPointSettings, type ExtensionPointStore } from '@omniviewdev/runtime';
import React from 'react';

const ExtensionSettingsPage: React.FC = () => {
  const theme = useTheme();
  const extensions = useExtensionRegistry();
  const isNormalScreenSize = useMediaQuery(theme.breakpoints.up('lg'));

  const [selected, setSelected] = React.useState<ExtensionPointStore<any> | undefined>(undefined);
  const [selectedSettings, setSelectedSettings] = React.useState<ExtensionPointSettings | undefined>(undefined);

  const selectExtensionPoint = (id: string) => {
    const extension = extensions?.getExtensionPoint(id);

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
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 2,
          width: '100%',
          py: 1,
          px: 2,
          gap: 1.5,
          border: '1px solid',
          borderColor: 'divider',
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
          <Text weight='semibold' size={isNormalScreenSize ? 'lg' : 'md'}>
            Extension
          </Text>
          <Text size='xs'>
            View and manage the installed extensions in the IDE
          </Text>
        </Stack>
      </Box>

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
          sx={{ p: 0.5, border: '1px solid', borderColor: 'divider' }}
        >
          <Box sx={{ p: 2 }}>
            <Stack spacing={0} direction={'column'}>
              <Text sx={{ p: 1, fontWeight: 700, fontSize: '1.25rem' }}>Extension Points</Text>
              <List
                size={'sm'}
                sx={{ width: 350, borderRadius: 2, bgcolor: 'action.hover' }}
              >
                {extensions?.listExtensionPoints().map((extension) => (
                  <ListItem key={extension.id}>
                    <Box
                      sx={{
                        cursor: 'pointer',
                        p: 1,
                        borderRadius: 1,
                        width: '100%',
                        bgcolor: selected?.settings().id === extension.id ? 'action.selected' : 'transparent',
                      }}
                      onClick={() => {
                        selectExtensionPoint(extension.id);
                      }}
                    >
                      {extension.id}
                    </Box>
                  </ListItem>
                ))}
              </List>
            </Stack>
          </Box>
        </Card>

        {selected && (
          <Box
            sx={{
              backgroundColor: theme.palette.background.paper,
              width: '100%',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
            }}
          >

            <Card sx={{ border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ p: 2 }}>
                <Stack direction="row" gap={2} justifyContent={'space-between'}>
                  <Stack direction='row' alignItems='center' gap={1}>
                    <Text weight='semibold'>
                      {selectedSettings?.name}
                    </Text>
                    <Chip variant='outlined' sx={{ borderRadius: 1, ml: 1 }} label={`${selectedSettings?.mode} display`} />
                  </Stack>
                  {selectedSettings?.mode &&
                    <Chip color='primary' sx={{ borderRadius: 1 }} label={selectedSettings?.id ?? ''} />
                  }
                </Stack>
                <Stack direction="row" gap={2} justifyContent={'space-between'}>
                  <Text>{selectedSettings?.description}</Text>
                </Stack>
              </Box>
            </Card>
            <ExtensionPointDisplay extensionPoint={selected} />
          </Box>
        )}
      </Box>
    </Stack>
  );
};

type ExtensionPointDisplayProps = {
  extensionPoint: ExtensionPointStore<any>;
};

const ExtensionPointDisplay: React.FC<ExtensionPointDisplayProps> = ({ extensionPoint }) => {
  const registrations = extensionPoint.list();

  if (!registrations?.length) {
    return (
      <Box sx={{ height: '100%', width: '100%', textAlign: 'center', alignContent: 'center' }}>
        <Text>No extensions have been registered for this extension point</Text>
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
