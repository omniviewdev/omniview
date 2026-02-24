import React from 'react';

// material-ui
import Box from '@mui/material/Box';
import { Card } from '@omniviewdev/ui';
import { Chip } from '@omniviewdev/ui';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';
import { Text } from '@omniviewdev/ui/typography';
import { stringify, parse } from 'yaml';

// icons
import {
  LuCircleArrowUp,
  LuUndo2,
  LuGitCompare,
} from 'react-icons/lu';

// project-imports
import { DrawerContext, useExecuteAction, useRightDrawer } from '@omniviewdev/runtime';
import CodeEditor from '../../shared/CodeEditor';
import UpgradeDialog from './UpgradeDialog';

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
    <Grid size={4}>
      <Text sx={{ color: "neutral.400" }} size="sm">{label}</Text>
    </Grid>
    <Grid size={8}>
      <Text sx={{ fontWeight: 400, color: "neutral.100" }} weight="semibold" size="sm">
        {value}
      </Text>
    </Grid>
  </Grid>
);

/**
 * Parse a YAML manifest string into individual resource documents.
 */
function parseManifestResources(manifest: string): Array<{ kind: string; name: string; namespace?: string }> {
  if (!manifest) return [];
  const docs = manifest.split(/^---$/m).filter((d) => d.trim());
  const resources: Array<{ kind: string; name: string; namespace?: string }> = [];
  for (const doc of docs) {
    try {
      const parsed = parse(doc);
      if (parsed?.kind && parsed?.metadata?.name) {
        resources.push({
          kind: parsed.kind,
          name: parsed.metadata.name,
          namespace: parsed.metadata.namespace,
        });
      }
    } catch {
      // skip unparseable documents
    }
  }
  return resources;
}

/**
 * Renders a sidebar for a Helm Release resource.
 */
export const ReleaseSidebar: React.FC<Props> = ({ ctx }) => {
  // Per-action cached tab data
  const [tabData, setTabData] = React.useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = React.useState('0');
  const [showManifestDiff, setShowManifestDiff] = React.useState(false);
  const [prevManifest, setPrevManifest] = React.useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = React.useState(false);

  const connectionID = ctx.resource?.connectionID ?? '';
  const releaseName = ctx.data?.name ?? ctx.resource?.id ?? '';
  const namespace = ctx.data?.namespace ?? '';

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Release',
  });

  const { showResourceSidebar } = useRightDrawer();

  // Fetch tab data on tab change, caching results per action
  const fetchTabData = React.useCallback(async (actionID: string) => {
    if (tabData[actionID]) return; // Already cached
    try {
      const result = await executeAction({
        actionID,
        id: releaseName,
        namespace,
      });
      setTabData((prev) => ({ ...prev, [actionID]: result.data }));
    } catch {
      setTabData((prev) => ({ ...prev, [actionID]: null }));
    }
  }, [executeAction, releaseName, namespace, tabData]);

  React.useEffect(() => {
    const tabActions = ['get-values', 'get-manifest', 'get-notes', 'get-hooks', 'get-history', 'get-manifest'];
    const actionID = tabActions[Number(activeTab)];
    if (actionID && connectionID) {
      void fetchTabData(actionID);
    }
  }, [activeTab, connectionID, fetchTabData]);

  // Load previous revision manifest for diff
  const loadPrevManifest = React.useCallback(async () => {
    const revision = ctx.data?.version ?? 0;
    if (revision <= 1) return;
    try {
      const result = await executeAction({
        actionID: 'get-manifest',
        id: releaseName,
        namespace,
        params: { revision: revision - 1 },
      });
      setPrevManifest(result.data?.manifest ?? '');
    } catch {
      setPrevManifest('# Failed to load previous revision manifest');
    }
  }, [executeAction, releaseName, namespace, ctx.data?.version]);

  const handleToggleDiff = React.useCallback(() => {
    if (!showManifestDiff && prevManifest === null) {
      void loadPrevManifest();
    }
    setShowManifestDiff((prev) => !prev);
  }, [showManifestDiff, prevManifest, loadPrevManifest]);

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

  const currentManifest = tabData['get-manifest']?.manifest ?? '';
  const manifestResources = parseManifestResources(currentManifest);

  return (
    <Stack direction="column" width="100%" spacing={2}>
      {/* Header card */}
      <Card sx={{ p: 1.5, borderRadius: 'sm' }} emphasis="outline">
          <Stack direction="column" spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Text weight="semibold" size="lg">{releaseName}</Text>
              <Chip
                size="sm"
                emphasis="soft"
                color={statusColorMap[status] ?? 'neutral'}
                label={status}
              />
            </Stack>
            <Divider />
            <MetaEntry label="Namespace" value={namespace} />
            <MetaEntry label="Chart" value={`${chartName}-${chartVersion}`} />
            <MetaEntry label="App Version" value={appVersion} />
            <MetaEntry label="Revision" value={String(revision)} />
            {lastDeployed && <MetaEntry label="Updated" value={lastDeployed} />}
          </Stack>
      </Card>

      {/* Action buttons */}
      <Stack direction="row" spacing={1}>
        <IconButton
          size="sm"
          emphasis="outline"
          color="primary"
          disabled={isExecuting}
          onClick={() => setShowUpgrade(true)}
          title="Upgrade Release"
        >
          <LuCircleArrowUp />
        </IconButton>
        {revision > 1 && (
          <IconButton
            size="sm"
            emphasis="outline"
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
        tabs={[
          { key: '0', label: 'Values' },
          { key: '1', label: 'Manifest' },
          { key: '2', label: 'Notes' },
          { key: '3', label: 'Hooks' },
          { key: '4', label: 'History' },
          { key: '5', label: 'Resources' },
        ]}
        value={activeTab}
        onChange={(v) => setActiveTab(v)}
        sx={{ borderRadius: 'sm', bgcolor: 'transparent' }}
      />

      {/* Values - Monaco editor */}
      <TabPanel value='0' activeValue={activeTab}>
        <Box sx={{ height: 400, border: '1px solid', borderColor: 'neutral.700', borderRadius: 'sm', overflow: 'hidden' }}>
          <CodeEditor
            filename="values.yaml"
            language="yaml"
            value={tabData['get-values'] ? stringify(tabData['get-values']) : '# Loading...'}
            readOnly
            height={400}
          />
        </Box>
      </TabPanel>

      {/* Manifest - Monaco with diff toggle */}
      <TabPanel value='1' activeValue={activeTab}>
        {revision > 1 && (
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button
              size="sm"
              emphasis={showManifestDiff ? 'solid' : 'outline'}
              color="neutral"
              disabled={isExecuting}
              onClick={handleToggleDiff}
              startIcon={<LuGitCompare size={14} />}
            >
              {showManifestDiff ? 'Hide Diff' : 'Diff with Previous'}
            </Button>
          </Stack>
        )}
        <Box sx={{ height: 400, border: '1px solid', borderColor: 'neutral.700', borderRadius: 'sm', overflow: 'hidden' }}>
          <CodeEditor
            filename="manifest.yaml"
            language="yaml"
            value={currentManifest || '# Loading...'}
            readOnly
            diff={showManifestDiff && prevManifest !== null}
            original={prevManifest ?? ''}
            height={400}
          />
        </Box>
      </TabPanel>

      {/* Notes */}
      <TabPanel value='2' activeValue={activeTab}>
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
          {tabData['get-notes']?.notes ?? 'No release notes'}
        </Box>
      </TabPanel>

      {/* Hooks */}
      <TabPanel value='3' activeValue={activeTab}>
        {tabData['get-hooks']?.hooks?.length ? (
          <Stack spacing={1}>
            {(tabData['get-hooks'].hooks as any[]).map((hook: any, i: number) => (
              <Card key={i} emphasis="outline">
                  <Text weight="semibold" size="sm">{hook.name}</Text>
                  <Text size="xs" sx={{ color: "neutral.400" }}>
                    Kind: {hook.kind} | Weight: {hook.weight}
                  </Text>
                  {hook.events && (
                    <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
                      {(hook.events as string[]).map((e: string) => (
                        <Chip key={e} size="sm" emphasis="soft" label={e} />
                      ))}
                    </Stack>
                  )}
              </Card>
            ))}
          </Stack>
        ) : (
          <Text size="sm" sx={{ color: "neutral.400" }}>No hooks</Text>
        )}
      </TabPanel>

      {/* History */}
      <TabPanel value='4' activeValue={activeTab}>
        {tabData['get-history']?.revisions?.length ? (
          <Stack spacing={1}>
            {(tabData['get-history'].revisions as any[]).map((rev: any, i: number) => (
              <Card key={i} emphasis="outline">
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Text weight="semibold" size="sm">Revision {rev.version}</Text>
                    <Chip
                      size="sm"
                      emphasis="soft"
                      color={statusColorMap[rev.info?.status] ?? 'neutral'}
                      label={rev.info?.status}
                    />
                  </Stack>
                  <Text size="xs" sx={{ color: "neutral.400" }}>
                    {rev.info?.description ?? ''}
                  </Text>
                  {rev.version !== revision && (
                    <IconButton
                      size="sm"
                      emphasis="ghost"
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
              </Card>
            ))}
          </Stack>
        ) : (
          <Text size="sm" sx={{ color: "neutral.400" }}>No history</Text>
        )}
      </TabPanel>

      {/* Resources - parsed from manifest */}
      <TabPanel value='5' activeValue={activeTab}>
        {manifestResources.length > 0 ? (
          <Stack spacing={0.5}>
            {manifestResources.map((res, i) => (
              <Card
                key={i}
                sx={{
                  p: 1,
                  borderRadius: 'sm',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'background.level2' },
                }}
                emphasis="outline"
                onClick={() => {
                  // Attempt to navigate to the K8s resource sidebar
                  // This maps common kinds to their resource keys
                  const kindToGroup: Record<string, string> = {
                    Deployment: 'apps::v1',
                    Service: 'core::v1',
                    ConfigMap: 'core::v1',
                    Secret: 'core::v1',
                    ServiceAccount: 'core::v1',
                    Ingress: 'networking::v1',
                    PersistentVolumeClaim: 'core::v1',
                    StatefulSet: 'apps::v1',
                    DaemonSet: 'apps::v1',
                    Job: 'batch::v1',
                    CronJob: 'batch::v1',
                    Role: 'rbac::v1',
                    RoleBinding: 'rbac::v1',
                    ClusterRole: 'rbac::v1',
                    ClusterRoleBinding: 'rbac::v1',
                    NetworkPolicy: 'networking::v1',
                    HorizontalPodAutoscaler: 'autoscaling::v1',
                    PodDisruptionBudget: 'policy::v1',
                    Namespace: 'core::v1',
                  };
                  const group = kindToGroup[res.kind];
                  if (group) {
                    showResourceSidebar({
                      pluginID: 'kubernetes',
                      connectionID,
                      resourceKey: `${group}::${res.kind}`,
                      resourceID: res.name,
                      namespace: res.namespace ?? namespace,
                    });
                  }
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="sm" emphasis="soft" color="neutral" label={res.kind} />
                  <Text size="sm" weight="semibold">{res.name}</Text>
                  {res.namespace && (
                    <Text size="xs" sx={{ color: 'neutral.500' }}>{res.namespace}</Text>
                  )}
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : (
          <Text size="sm" sx={{ color: "neutral.400" }}>
            {tabData['get-manifest'] ? 'No resources found in manifest' : 'Loading manifest...'}
          </Text>
        )}
      </TabPanel>

      {/* Upgrade Dialog */}
      <UpgradeDialog
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        releaseName={releaseName}
        namespace={namespace}
        chartRef={`${chartName}`}
        connectionID={connectionID}
      />
    </Stack>
  );
};

ReleaseSidebar.displayName = 'ReleaseSidebar';
export default ReleaseSidebar;
