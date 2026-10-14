import React, { useState } from 'react';
import { Chip, IconButton, Stack, Tabs, Text } from '@omniviewdev/base-ui';
import { LuArrowLeft } from 'react-icons/lu';
import { usePluginRouter } from '@omniviewdev/runtime';
import { chipStyle, toColor } from '../ui/colors';

const truncateStyle: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const headerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--ov-color-border-default)',
  backgroundColor: 'var(--ov-color-bg-surface)',
  flexShrink: 0,
};
const panelStyle: React.CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <Stack
        direction='row'
        align='center'
        spacing={3}
        style={headerStyle}
      >
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label='Back'
          onClick={() => navigate(backPath)}
        >
          <LuArrowLeft size={18} />
        </IconButton>

        {icon && (
          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--ov-color-fg-muted)', fontSize: 20 }}>
            {icon}
          </div>
        )}

        <Stack spacing={0} style={{ minWidth: 0 }}>
          <Text weight="semibold" size="sm" style={truncateStyle}>{title}</Text>
          {subtitle && <Text size="xs" tone="muted" style={truncateStyle}>{subtitle}</Text>}
        </Stack>

        {status && (
          <Chip size='sm' color={toColor(statusColor)} variant='solid' style={chipStyle}>{status}</Chip>
        )}

        {headerDetails && headerDetails.length > 0 && (
          <Stack direction='row' spacing={2} style={{ marginLeft: 'auto' }}>
            {headerDetails.map((detail) => (
              <Chip key={detail.label} size='sm' color='neutral' variant='outline' style={chipStyle}>
                {`${detail.label}: ${detail.value}`}
              </Chip>
            ))}
          </Stack>
        )}
      </Stack>

      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(String(value))}
        size="sm"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <Tabs.List style={{ flexShrink: 0 }}>
          {tabs.map((tab, i) => (
            <Tabs.Tab
              key={i}
              value={String(i)}
              startDecorator={tab.icon ? (
                <span style={{ display: 'flex', alignItems: 'center', fontSize: 14 }}>{tab.icon}</span>
              ) : undefined}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator />
        </Tabs.List>
        {tabs.map((tab, i) => (
          <Tabs.Panel key={i} value={String(i)} style={panelStyle}>
            {tab.content}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </div>
  );
};

ResourceDetailPage.displayName = 'ResourceDetailPage';

export default ResourceDetailPage;
