import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import Grid from '@mui/joy/Grid';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import Tab from '@mui/joy/Tab';
import TabList from '@mui/joy/TabList';
import TabPanel from '@mui/joy/TabPanel';
import Tabs from '@mui/joy/Tabs';
import Typography from '@mui/joy/Typography';

// icons
import {
  LuCircleArrowUp,
  LuUndo2,
  LuFileText,
  LuFileCode,
  LuStickyNote,
  LuAnchor,
  LuHistory,
} from 'react-icons/lu';

// project-imports
import { DrawerContext, useExecuteAction } from '@omniviewdev/runtime';

// ── types ──
type HelmRelease = Record<string, any>;

interface Props {
  ctx: DrawerContext<HelmRelease>;
}

const statusColorMap: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  deployed: 'success',
  failed: 'danger',
  'pending-install': 'warning',
  'pending-upgrade': 'warning',
  'pending-rollback': 'warning',
  superseded: 'neutral',
  uninstalling: 'warning',
  uninstalled: 'neutral',
};

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Grid container spacing={0}>
    <Grid xs={4}>
      <Typography textColor="neutral.400" level="body-sm">{label}</Typography>
    </Grid>
    <Grid xs={8}>
      <Typography fontWeight={400} textColor="neutral.100" level="title-sm">
        {value}
      </Typography>
    </Grid>
  </Grid>
);

/**
 * Renders a sidebar for a Helm Release resource.
 */
export const ReleaseSidebar: React.FC<Props> = ({ ctx }) => {
  const [actionData, setActionData] = React.useState<Record<string, any> | null>(null);
  const [activeTab, setActiveTab] = React.useState(0);

  const connectionID = ctx.resource?.connectionID ?? '';
  const releaseName = ctx.data?.name ?? ctx.resource?.id ?? '';
  const namespace = ctx.data?.namespace ?? '';

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Release',
  });

  // Fetch tab data on tab change
  const fetchTabData = React.useCallback(async (actionID: string) => {
    try {
      const result = await executeAction({
        actionID,
        id: releaseName,
        namespace,
      });
      setActionData(result.data);
    } catch {
      setActionData(null);
    }
  }, [executeAction, releaseName, namespace]);

  React.useEffect(() => {
    const tabActions = ['get-values', 'get-manifest', 'get-notes', 'get-hooks', 'get-history'];
    const actionID = tabActions[activeTab];
    if (actionID && connectionID) {
      void fetchTabData(actionID);
    }
  }, [activeTab, connectionID, fetchTabData]);

  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;
  const status = data.info?.status ?? 'unknown';
  const chartName = data.chart?.metadata?.name ?? '';
  const chartVersion = data.chart?.metadata?.version ?? '';
  const appVersion = data.chart?.metadata?.appVersion ?? '';
  const revision = data.version ?? 0;
  const lastDeployed = data.info?.last_deployed ?? '';

  return (
    <Stack direction="column" width="100%" spacing={2}>
      {/* Header card */}
      <Card sx={{ '--Card-padding': '12px', borderRadius: 'sm' }} variant="outlined">
        <CardContent>
          <Stack direction="column" spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography level="title-lg">{releaseName}</Typography>
              <Chip
                size="sm"
                variant="soft"
                color={statusColorMap[status] ?? 'neutral'}
              >
                {status}
              </Chip>
            </Stack>
            <Divider />
            <MetaEntry label="Namespace" value={namespace} />
            <MetaEntry label="Chart" value={`${chartName}-${chartVersion}`} />
            <MetaEntry label="App Version" value={appVersion} />
            <MetaEntry label="Revision" value={String(revision)} />
            {lastDeployed && <MetaEntry label="Updated" value={lastDeployed} />}
          </Stack>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <Stack direction="row" spacing={1}>
        <IconButton
          size="sm"
          variant="outlined"
          color="primary"
          disabled={isExecuting}
          title="Upgrade Release"
        >
          <LuCircleArrowUp />
        </IconButton>
        {revision > 1 && (
          <IconButton
            size="sm"
            variant="outlined"
            color="warning"
            disabled={isExecuting}
            onClick={() => void executeAction({
              actionID: 'rollback',
              id: releaseName,
              namespace,
              params: { revision: revision - 1 },
            })}
            title="Rollback Release"
          >
            <LuUndo2 />
          </IconButton>
        )}
      </Stack>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v as number)}
        sx={{ borderRadius: 'sm', bgcolor: 'transparent' }}
      >
        <TabList size="sm" variant="plain">
          <Tab><LuFileText size={14} />&nbsp;Values</Tab>
          <Tab><LuFileCode size={14} />&nbsp;Manifest</Tab>
          <Tab><LuStickyNote size={14} />&nbsp;Notes</Tab>
          <Tab><LuAnchor size={14} />&nbsp;Hooks</Tab>
          <Tab><LuHistory size={14} />&nbsp;History</Tab>
        </TabList>

        {/* Values */}
        <TabPanel value={0} sx={{ p: 1 }}>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              fontFamily: 'monospace',
              bgcolor: 'background.level1',
              p: 1.5,
              borderRadius: 'sm',
              overflow: 'auto',
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {actionData ? JSON.stringify(actionData, null, 2) : 'Loading...'}
          </Box>
        </TabPanel>

        {/* Manifest */}
        <TabPanel value={1} sx={{ p: 1 }}>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              fontFamily: 'monospace',
              bgcolor: 'background.level1',
              p: 1.5,
              borderRadius: 'sm',
              overflow: 'auto',
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {actionData?.manifest ?? 'Loading...'}
          </Box>
        </TabPanel>

        {/* Notes */}
        <TabPanel value={2} sx={{ p: 1 }}>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              fontFamily: 'monospace',
              bgcolor: 'background.level1',
              p: 1.5,
              borderRadius: 'sm',
              overflow: 'auto',
              maxHeight: 400,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {actionData?.notes ?? 'No release notes'}
          </Box>
        </TabPanel>

        {/* Hooks */}
        <TabPanel value={3} sx={{ p: 1 }}>
          {actionData?.hooks?.length ? (
            <Stack spacing={1}>
              {(actionData.hooks as any[]).map((hook: any, i: number) => (
                <Card key={i} variant="outlined" size="sm">
                  <CardContent>
                    <Typography level="title-sm">{hook.name}</Typography>
                    <Typography level="body-xs" textColor="neutral.400">
                      Kind: {hook.kind} | Weight: {hook.weight}
                    </Typography>
                    {hook.events && (
                      <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
                        {(hook.events as string[]).map((e: string) => (
                          <Chip key={e} size="sm" variant="soft">{e}</Chip>
                        ))}
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Stack>
          ) : (
            <Typography level="body-sm" textColor="neutral.400">No hooks</Typography>
          )}
        </TabPanel>

        {/* History */}
        <TabPanel value={4} sx={{ p: 1 }}>
          {actionData?.revisions?.length ? (
            <Stack spacing={1}>
              {(actionData.revisions as any[]).map((rev: any, i: number) => (
                <Card key={i} variant="outlined" size="sm">
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography level="title-sm">Revision {rev.version}</Typography>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColorMap[rev.info?.status] ?? 'neutral'}
                      >
                        {rev.info?.status}
                      </Chip>
                    </Stack>
                    <Typography level="body-xs" textColor="neutral.400">
                      {rev.info?.description ?? ''}
                    </Typography>
                    {rev.version !== revision && (
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="warning"
                        disabled={isExecuting}
                        onClick={() => void executeAction({
                          actionID: 'rollback',
                          id: releaseName,
                          namespace,
                          params: { revision: rev.version },
                        })}
                        title={`Rollback to revision ${rev.version}`}
                        sx={{ mt: 0.5 }}
                      >
                        <LuUndo2 size={14} />
                      </IconButton>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Stack>
          ) : (
            <Typography level="body-sm" textColor="neutral.400">No history</Typography>
          )}
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ReleaseSidebar.displayName = 'ReleaseSidebar';
export default ReleaseSidebar;
