import React, { useState } from 'react';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Chip } from '@omniviewdev/ui';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';
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

  const [activeTab, setActiveTab] = useState("0");
  const chipColor = statusColor === 'neutral' ? 'default' : statusColor === 'danger' ? 'error' : statusColor;
  const headerChipColor = 'default';

  const tabItems = tabs.map((tab, i) => ({
    key: String(i),
    label: tab.label,
    icon: tab.icon ? (
      <Box sx={{ display: 'flex', alignItems: 'center', mr: 0.5, fontSize: 14 }}>
        {tab.icon}
      </Box>
    ) : undefined,
  }));

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
          bgcolor: 'background.paper',
          flexShrink: 0,
        }}
      >
        <IconButton
          size='sm'
          emphasis='ghost'
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
          <Text weight="semibold" size="sm" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Text>
          {subtitle && <Text size="xs" color="neutral" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</Text>}
        </Stack>

        {status && (
          <Chip size='sm' label={status} color={chipColor} variant='filled' sx={{ borderRadius: 1 }} />
        )}

        {headerDetails && headerDetails.length > 0 && (
          <Stack direction='row' spacing={1} sx={{ ml: 'auto' }}>
            {headerDetails.map((detail) => (
              <Chip key={detail.label} size='sm' label={`${detail.label}: ${detail.value}`} color={headerChipColor} variant='outlined' sx={{ borderRadius: 1 }} />
            ))}
          </Stack>
        )}
      </Stack>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={tabItems}
        size="sm"
        sx={{ flexShrink: 0 }}
      />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tabs.map((tab, i) => (
          <TabPanel key={i} value={String(i)} activeValue={activeTab}>
            <Box sx={{ flex: 1, minHeight: 0, p: 0, display: 'flex', flexDirection: 'column' }}>
              {tab.content}
            </Box>
          </TabPanel>
        ))}
      </Box>
    </Box>
  );
};

ResourceDetailPage.displayName = 'ResourceDetailPage';

export default ResourceDetailPage;
