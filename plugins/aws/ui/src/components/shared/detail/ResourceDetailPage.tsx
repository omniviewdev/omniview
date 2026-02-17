import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Typography,
} from '@mui/joy';
import { LuArrowLeft } from 'react-icons/lu';
import { usePluginRouter } from '@omniviewdev/runtime';

type TabDef = {
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
};

type HeaderDetail = {
  label: string;
  value: string;
};

type Props = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  status?: string;
  statusColor?: 'success' | 'warning' | 'danger' | 'neutral';
  headerDetails?: HeaderDetail[];
  tabs: TabDef[];
  backPath: string;
};

const ResourceDetailPage: React.FC<Props> = ({
  title,
  subtitle,
  icon,
  status,
  statusColor = 'neutral',
  headerDetails,
  tabs,
  backPath,
}) => {
  const { navigate } = usePluginRouter();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <Stack
        direction='row'
        alignItems='center'
        spacing={1.5}
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.surface',
          flexShrink: 0,
        }}
      >
        <IconButton
          size='sm'
          variant='plain'
          color='neutral'
          onClick={() => navigate(backPath)}
        >
          <LuArrowLeft size={18} />
        </IconButton>

        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary', fontSize: 20 }}>
            {icon}
          </Box>
        )}

        <Stack spacing={0} sx={{ minWidth: 0 }}>
          <Typography level='title-md' noWrap>{title}</Typography>
          {subtitle && <Typography level='body-xs' color='neutral' noWrap>{subtitle}</Typography>}
        </Stack>

        {status && (
          <Chip size='sm' variant='soft' color={statusColor} sx={{ borderRadius: 'sm' }}>
            {status}
          </Chip>
        )}

        {headerDetails && headerDetails.length > 0 && (
          <Stack direction='row' spacing={1} sx={{ ml: 'auto' }}>
            {headerDetails.map((detail) => (
              <Chip key={detail.label} size='sm' variant='outlined' color='neutral'>
                {detail.label}: {detail.value}
              </Chip>
            ))}
          </Stack>
        )}
      </Stack>

      {/* Tabs */}
      <Tabs defaultValue={0} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <TabList
          size='sm'
          sx={{
            px: 1.5,
            flexShrink: 0,
            '--ListItem-minHeight': '36px',
          }}
        >
          {tabs.map((tab, i) => (
            <Tab key={i} value={i}>
              {tab.icon && (
                <Box sx={{ display: 'flex', alignItems: 'center', mr: 0.5, fontSize: 14 }}>
                  {tab.icon}
                </Box>
              )}
              {tab.label}
            </Tab>
          ))}
        </TabList>
        {tabs.map((tab, i) => (
          <TabPanel key={i} value={i} sx={{ flex: 1, minHeight: 0, p: 0, display: 'flex', flexDirection: 'column' }}>
            {tab.content}
          </TabPanel>
        ))}
      </Tabs>
    </Box>
  );
};

ResourceDetailPage.displayName = 'ResourceDetailPage';

export default ResourceDetailPage;
