import React from 'react';

// material-ui
import Box from '@mui/material/Box';
import { Card } from '@omniviewdev/ui';
import { Chip } from '@omniviewdev/ui';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// icons
import { LuRefreshCw, LuLink, LuShieldCheck, LuShieldOff } from 'react-icons/lu';

// project-imports
import { DrawerContext, useExecuteAction, useResources, useRightDrawer } from '@omniviewdev/runtime';
import NamedAvatar from '../../shared/NamedAvatar';

// ── types ──
type HelmRepo = Record<string, any>;

interface Props {
  ctx: DrawerContext<HelmRepo>;
}

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Grid container spacing={0}>
    <Grid size={3}>
      <Text sx={{ color: "neutral.400" }} size="sm">{label}</Text>
    </Grid>
    <Grid size={9}>
      <Text sx={{ fontWeight: 400, color: "neutral.100" }} weight="semibold" size="sm">
        {value}
      </Text>
    </Grid>
  </Grid>
);

/** Chart icon with image fallback to NamedAvatar */
const ChartIcon: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = React.useState(false);
  if (icon && !failed) {
    return (
      <Box
        sx={{
          width: 36, height: 36, borderRadius: '6px', flexShrink: 0,
          bgcolor: 'rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Box
          component="img"
          src={icon}
          alt={name}
          onError={() => setFailed(true)}
          sx={{ width: 30, height: 30, objectFit: 'contain', borderRadius: '4px' }}
        />
      </Box>
    );
  }
  return <NamedAvatar value={name} />;
};

/**
 * Renders a sidebar for a Helm Repository resource.
 * Uses the Chart resource list (cached by React Query) filtered by repository
 * instead of making a separate action call each time.
 */
export const RepoSidebar: React.FC<Props> = ({ ctx }) => {
  const connectionID = ctx.resource?.connectionID ?? '';
  const repoName = ctx.data?.name ?? ctx.resource?.id ?? '';
  const [chartFilter, setChartFilter] = React.useState('');

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Repository',
  });

  // Use the existing Chart resource list — cached by React Query
  const { resources: chartsQuery } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Chart',
    idAccessor: 'id',
  });

  const { showResourceSidebar } = useRightDrawer();

  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  // Filter charts by this repository
  const allCharts = (chartsQuery.data?.result ?? []) as Array<Record<string, any>>;
  const repoCharts = allCharts.filter((c) => c.repository === repoName);

  const filteredCharts = chartFilter
    ? repoCharts.filter((c) => {
        const name = (c.name as string ?? '').toLowerCase();
        const desc = (c.description as string ?? '').toLowerCase();
        return name.includes(chartFilter.toLowerCase()) || desc.includes(chartFilter.toLowerCase());
      })
    : repoCharts;

  return (
    <Stack direction="column" width="100%" sx={{ height: '100%', minHeight: 0 }}>
      {/* ── Fixed header ── */}
      <Card sx={{ p: 1.5, borderRadius: 'sm', flexShrink: 0, overflow: 'visible' }} emphasis="outline">
          <Stack direction="column" spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" alignItems="center" spacing={1}>
                <Text weight="semibold" size="lg">{repoName}</Text>
                {data.type === 'oci' && (
                  <Chip size="sm" emphasis="soft" color="info" label="OCI" />
                )}
              </Stack>
              <IconButton
                size="sm"
                emphasis="outline"
                color="primary"
                disabled={isExecuting}
                onClick={() => void executeAction({
                  actionID: 'refresh',
                  id: repoName,
                })}
                title="Refresh Repository"
              >
                <LuRefreshCw />
              </IconButton>
            </Stack>
            <Divider />
            <MetaEntry
              label="URL"
              value={
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <LuLink size={12} />
                  <Text size="sm" sx={{ wordBreak: 'break-all' }}>
                    {data.url ?? '—'}
                  </Text>
                </Stack>
              }
            />
            {data.username && <MetaEntry label="Username" value={data.username} />}
            <MetaEntry
              label="TLS"
              value={
                <Chip
                  size="sm"
                  emphasis="soft"
                  color={data.insecure_skip_tls_verify ? 'warning' : 'success'}
                  startAdornment={
                    data.insecure_skip_tls_verify
                      ? <LuShieldOff size={12} />
                      : <LuShieldCheck size={12} />
                  }
                  label={data.insecure_skip_tls_verify ? 'Insecure' : 'Verified'}
                />
              }
            />
          </Stack>
      </Card>

      {/* ── Charts section — fills remaining space ── */}
      <Stack direction="column" spacing={1} sx={{ flex: 1, minHeight: 0, mt: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexShrink: 0 }}>
          <Text weight="semibold" size="sm">
            Charts in this repository ({repoCharts.length})
          </Text>
        </Stack>

        {/* Search */}
        <TextField
          value={chartFilter}
          onChange={setChartFilter}
          placeholder="Filter charts..."
          size="sm"
          fullWidth
          autoComplete="off"
        />

        {/* Chart list — scrolls within remaining space */}
        <Stack
          direction="column"
          spacing={0.5}
          sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          {filteredCharts.map((chart) => (
            <Card
              key={chart.id as string}
              sx={{
                p: 1,
                overflow: 'visible',
                flexShrink: 0,
                borderRadius: 'sm',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'background.level2' },
              }}
              emphasis="outline"
              onClick={() => showResourceSidebar({
                pluginID: 'kubernetes',
                connectionID,
                resourceKey: 'helm::v1::Chart',
                resourceID: chart.id as string,
              })}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <ChartIcon icon={chart.icon as string} name={chart.name as string} />
                <Stack direction="column" spacing={0} sx={{ flex: 1, minWidth: 0 }}>
                  <Text weight="semibold" size="sm">{chart.name as string}</Text>
                  {(chart.description as string) && (
                    <Text size="xs" sx={{
                      color: 'neutral.400',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {chart.description as string}
                    </Text>
                  )}
                  <Text size="xs" sx={{ color: 'neutral.500', mt: 0.25 }}>
                    v{chart.version as string}
                    {chart.appVersion && ` · App: ${chart.appVersion as string}`}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          ))}
          {chartsQuery.isSuccess && filteredCharts.length === 0 && (
            <Text size="sm" sx={{ color: 'neutral.400', textAlign: 'center', py: 2 }}>
              {chartFilter
                ? 'No charts match the filter'
                : data.type === 'oci'
                  ? 'OCI registries do not provide a chart index. Reference charts directly by their OCI URL.'
                  : 'No charts found. Try refreshing the repository.'}
            </Text>
          )}
          {chartsQuery.isLoading && (
            <Text size="sm" sx={{ color: 'neutral.400', textAlign: 'center', py: 2 }}>
              Loading charts...
            </Text>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
};

RepoSidebar.displayName = 'RepoSidebar';
export default RepoSidebar;
