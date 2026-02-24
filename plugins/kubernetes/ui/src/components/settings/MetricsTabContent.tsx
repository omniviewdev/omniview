import React, { useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import CircularProgress from '@mui/material/CircularProgress';
import { Card, Chip } from '@omniviewdev/ui';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { FormField, TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import {
  LuActivity,
  LuCheck,
  LuCircle,
  LuInfo,
  LuPlugZap,
  LuRefreshCw,
  LuX,
} from 'react-icons/lu';
import { useQueryClient } from '@tanstack/react-query';
import { MetricClient } from '@omniviewdev/runtime/api';
import { useMetricProvidersForResource } from '@omniviewdev/runtime';
import { useClusterPreferences } from '../../hooks/useClusterPreferences';
import type { MetricConfig } from '../../types/clusters';

interface Props {
  pluginID: string;
  connectionID: string;
  connected: boolean;
}

const WELL_KNOWN_SERVICES = [
  { name: 'prometheus-server', desc: 'Default Helm chart' },
  { name: 'prometheus-kube-prometheus-prometheus', desc: 'kube-prometheus-stack' },
  { name: 'prometheus-operated', desc: 'Prometheus Operator' },
  { name: 'prometheus', desc: 'Generic' },
];

const WELL_KNOWN_NAMESPACES = [
  'monitoring',
  'prometheus',
  'kube-prometheus-stack',
  'observability',
  'default',
];

type TestState = 'idle' | 'testing' | 'success' | 'failure';

const MetricsTabContent: React.FC<Props> = ({ pluginID, connectionID, connected }) => {
  const queryClient = useQueryClient();
  const { connectionOverrides, updateOverride } = useClusterPreferences(pluginID);
  const existing = connectionOverrides[connectionID] ?? {};
  const metricConfig = existing.metricConfig ?? {};

  const { data: providers, isLoading: providersLoading } = useMetricProvidersForResource('core::v1::Pod');

  // Invalidate provider cache on mount so we don't show stale 0-provider results
  React.useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['metric', 'providers'] });
  }, [queryClient]);

  const [service, setService] = React.useState(metricConfig.prometheusService ?? '');
  const [namespace, setNamespace] = React.useState(metricConfig.prometheusNamespace ?? '');
  const [port, setPort] = React.useState(metricConfig.prometheusPort?.toString() ?? '');

  const [testState, setTestState] = React.useState<TestState>('idle');
  const [testError, setTestError] = React.useState('');
  const abortRef = useRef(false);

  // Sync when overrides load async
  React.useEffect(() => {
    const cfg = connectionOverrides[connectionID]?.metricConfig;
    if (cfg) {
      setService(prev => prev || cfg.prometheusService || '');
      setNamespace(prev => prev || cfg.prometheusNamespace || '');
      setPort(prev => prev || cfg.prometheusPort?.toString() || '');
    }
  }, [connectionOverrides, connectionID]);

  const saveConfig = useCallback(async () => {
    const mc: MetricConfig = {};
    if (service) mc.prometheusService = service;
    if (namespace) mc.prometheusNamespace = namespace;
    const portNum = parseInt(port, 10);
    if (portNum > 0) mc.prometheusPort = portNum;
    await updateOverride(connectionID, {
      ...existing,
      metricConfig: Object.keys(mc).length > 0 ? mc : undefined,
    });
  }, [service, namespace, port, connectionID, existing, updateOverride]);

  const onBlur = () => { void saveConfig(); };

  const handleTest = useCallback(async () => {
    // Save current form values first
    await saveConfig();

    const providerCount = providers?.length ?? 0;
    if (providerCount === 0) {
      setTestState('failure');
      setTestError(
        'No metric providers registered. The plugin may need to be rebuilt, ' +
        'or try disconnecting and reconnecting the cluster.',
      );
      return;
    }

    setTestState('testing');
    setTestError('');
    abortRef.current = false;

    // Build resourceData with per-connection config
    const resourceData: Record<string, unknown> = {};
    if (service || namespace || port) {
      resourceData.__metric_config__ = {
        service: service || '',
        namespace: namespace || '',
        port: parseInt(port, 10) || 0,
      };
    }

    try {
      // Call QueryAll via the MetricClient binding — bypasses the
      // useResourceMetrics hook's provider-count guard so we get a real
      // backend round-trip even when the provider cache is stale.
      const results = await MetricClient.QueryAll(
        connectionID,
        'cluster::metrics',
        '_test',
        '',
        resourceData as Record<string, any>,
        ['prom_cluster_node_count'],
        0, // ShapeCurrent
        new Date(0),
        new Date(0),
        0, // step
      );

      if (abortRef.current) return;

      // Check if any provider returned successful results
      const hasResults = results && Object.values(results).some(
        (resp: any) => resp?.success && resp?.results && resp.results.length > 0,
      );

      if (hasResults) {
        setTestState('success');
        setTestError('');
      } else {
        setTestState('failure');
        setTestError(
          'Prometheus not detected or returned no data. ' +
          'Check that the service name, namespace, and port are correct.',
        );
      }
    } catch (err: any) {
      if (abortRef.current) return;
      setTestState('failure');
      setTestError(err?.message || 'Connection test failed');
    }
  }, [saveConfig, providers, connectionID, service, namespace, port]);

  const handleCancel = () => {
    abortRef.current = true;
    setTestState('idle');
    setTestError('');
  };

  const handleRefreshProviders = () => {
    queryClient.invalidateQueries({ queryKey: ['metric', 'providers'] });
  };

  // Auto-dismiss test result after 8s
  React.useEffect(() => {
    if (testState === 'success' || testState === 'failure') {
      const timer = setTimeout(() => setTestState('idle'), 8000);
      return () => clearTimeout(timer);
    }
  }, [testState]);

  const providerCount = providers?.length ?? 0;

  return (
    <Stack direction='column' gap={1.5}>
      {/* Provider status */}
      <Card variant='outlined' sx={{ borderColor: 'divider' }}>
        <Box sx={{ p: 1.5 }}>
          <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 1 }}>
            <Stack direction='row' alignItems='center' gap={0.75}>
              <LuActivity size={14} />
              <Text size='sm' weight='semibold'>Metric Providers</Text>
            </Stack>
            <IconButton size='sm' emphasis='ghost' onClick={handleRefreshProviders}>
              <LuRefreshCw size={12} />
            </IconButton>
          </Stack>
          <Stack direction='row' gap={0.75} flexWrap='wrap'>
            <Chip
              size='sm'
              emphasis='soft'
              color={connected && providerCount > 0 ? 'success' : providersLoading ? 'neutral' : 'warning'}
              startAdornment={providersLoading
                ? <CircularProgress size={7} sx={{ color: 'inherit' }} />
                : <LuCircle size={7} fill='currentColor' />
              }
              label={!connected
                ? 'Connect cluster to check providers'
                : providersLoading
                ? 'Checking providers...'
                : providerCount > 0
                ? `${providerCount} provider${providerCount !== 1 ? 's' : ''} registered`
                : '0 providers registered'}
            />
          </Stack>
          {connected && providerCount === 0 && !providersLoading && (
            <Box sx={{ mt: 1, px: 1, py: 0.75, borderRadius: 1, bgcolor: 'warning.softBg', border: '1px solid', borderColor: 'warning.softColor' }}>
              <Text size='xs' sx={{ lineHeight: 1.4 }}>
                No metric providers found. This usually means the plugin binary needs
                to be rebuilt with metric support, or the plugin hasn't fully initialized yet.
                Try reconnecting the cluster or restarting the app.
              </Text>
            </Box>
          )}
          {connected && providerCount > 0 && (
            <Stack gap={0.5} sx={{ mt: 1 }}>
              {providers!.map(p => (
                <Box
                  key={p.provider_id}
                  sx={{ px: 1.25, py: 0.5, borderRadius: 1, bgcolor: 'background.level1', display: 'flex', flexDirection: 'column' }}
                >
                  <Text size='xs' weight='medium'>{p.name || p.provider_id}</Text>
                  {p.description && (
                    <Text size='xs' sx={{ opacity: 0.5 }}>{p.description}</Text>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </Card>

      {/* Prometheus configuration */}
      <Card variant='outlined' sx={{ borderColor: 'divider' }}>
        <Box sx={{ p: 1.5 }}>
          <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 0.5 }}>
            <Text size='sm' weight='semibold'>Prometheus Configuration</Text>
            <Stack direction='row' gap={0.5}>
              {testState === 'testing' && (
                <Button size='sm' emphasis='ghost' color='neutral' onClick={handleCancel}>
                  Cancel
                </Button>
              )}
              <Button
                size='sm'
                emphasis='ghost'
                color={testState === 'success' ? 'success' : testState === 'failure' ? 'danger' : 'primary'}
                disabled={!connected || testState === 'testing'}
                startAdornment={
                  testState === 'testing' ? <CircularProgress size={12} sx={{ color: 'inherit' }} />
                  : testState === 'success' ? <LuCheck size={14} />
                  : testState === 'failure' ? <LuX size={14} />
                  : <LuPlugZap size={14} />
                }
                onClick={handleTest}
              >
                {testState === 'testing' ? 'Testing...'
                  : testState === 'success' ? 'Connected'
                  : testState === 'failure' ? 'Retry'
                  : 'Test Connection'}
              </Button>
            </Stack>
          </Stack>
          <Text size='xs' sx={{ mb: 1.5, opacity: 0.6 }}>
            Override Prometheus service details for this cluster. Leave fields empty to use auto-detection.
          </Text>

          {/* Test result banner */}
          {testState === 'success' && (
            <Box sx={{ mb: 1.5, px: 1.25, py: 0.75, borderRadius: 1, bgcolor: 'success.softBg', border: '1px solid', borderColor: 'success.softColor' }}>
              <Stack direction='row' gap={0.75} alignItems='center'>
                <LuCheck size={14} />
                <Text size='xs' weight='medium'>Prometheus is reachable and returning data.</Text>
              </Stack>
            </Box>
          )}
          {testState === 'failure' && (
            <Box sx={{ mb: 1.5, px: 1.25, py: 0.75, borderRadius: 1, bgcolor: 'error.softBg', border: '1px solid', borderColor: 'error.softColor' }}>
              <Stack direction='row' gap={0.75} alignItems='flex-start'>
                <Box sx={{ mt: 0.125, flexShrink: 0 }}><LuX size={14} /></Box>
                <Text size='xs' weight='medium'>{testError || 'Could not reach Prometheus.'}</Text>
              </Stack>
            </Box>
          )}

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 5 }}>
              <FormField label='Service Name'>
                <TextField
                  size='sm'
                  placeholder='prometheus-server'
                  value={service}
                  onChange={setService}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <FormField label='Namespace'>
                <TextField
                  size='sm'
                  placeholder='monitoring'
                  value={namespace}
                  onChange={setNamespace}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <FormField label='Port'>
                <TextField
                  size='sm'
                  placeholder='9090'
                  value={port}
                  onChange={setPort}
                  onBlur={onBlur}
                />
              </FormField>
            </Grid>
          </Grid>

          <Stack direction='row' gap={0.75} alignItems='flex-start' sx={{ mt: 1.25 }}>
            <Box sx={{ color: 'text.tertiary', mt: 0.25, flexShrink: 0 }}>
              <LuInfo size={12} />
            </Box>
            <Text size='xs' sx={{ color: 'text.tertiary', lineHeight: 1.4 }}>
              When fields are empty, the backend scans for well-known Prometheus service names
              and namespaces automatically. Set these values if your Prometheus installation uses
              a non-standard configuration.
            </Text>
          </Stack>
        </Box>
      </Card>

      {/* Auto-detection reference */}
      <Card variant='outlined' sx={{ borderColor: 'divider' }}>
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column' }}>
          <Text size='sm' weight='semibold' sx={{ mb: 0.25 }}>Auto-Detection Reference</Text>
          <Text size='xs' sx={{ mb: 1.25, opacity: 0.5 }}>
            Well-known service names and namespaces scanned during auto-detection.
          </Text>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Text size='xs' weight='semibold' sx={{ mb: 0.5, textTransform: 'uppercase', opacity: 0.4, letterSpacing: '0.05em', fontSize: '0.6rem' }}>
                Service Names
              </Text>
              <Stack gap={0.25}>
                {WELL_KNOWN_SERVICES.map(s => (
                  <Stack key={s.name} direction='row' gap={0.75} alignItems='baseline' sx={{ px: 1, py: 0.375, borderRadius: 0.75, bgcolor: 'background.level1' }}>
                    <Text size='xs' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{s.name}</Text>
                    <Text size='xs' sx={{ opacity: 0.4, fontSize: '0.65rem' }}>{s.desc}</Text>
                  </Stack>
                ))}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Text size='xs' weight='semibold' sx={{ mb: 0.5, textTransform: 'uppercase', opacity: 0.4, letterSpacing: '0.05em', fontSize: '0.6rem' }}>
                Namespaces
              </Text>
              <Stack gap={0.25}>
                {WELL_KNOWN_NAMESPACES.map(ns => (
                  <Box key={ns} sx={{ px: 1, py: 0.375, borderRadius: 0.75, bgcolor: 'background.level1' }}>
                    <Text size='xs' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{ns}</Text>
                  </Box>
                ))}
              </Stack>
            </Grid>
          </Grid>
        </Box>
      </Card>
    </Stack>
  );
};

export default MetricsTabContent;
