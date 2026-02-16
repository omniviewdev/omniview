import React from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Grid,
  Stack,
  Typography,
} from '@mui/joy';
import {
  LuBox,
  LuCalendarClock,
  LuContainer,
  LuDatabase,
  LuListChecks,
  LuNetwork,
} from 'react-icons/lu';
import {
  useConnection,
  useExtensionPoint,
  useResources,
} from '@omniviewdev/runtime';

import NamespaceSelect from '../../../components/tables/NamespaceSelect';
import ClusterInfoCard from './components/ClusterInfoCard';
import WorkloadSummaryCard from './components/WorkloadSummaryCard';
import EventsTable from './EventsTable';

type KubeResource = Record<string, any>;

function filterByNamespace(resources: KubeResource[], namespaces: string[]): KubeResource[] {
  if (namespaces.length === 0) return resources;
  return resources.filter(r => namespaces.includes(r.metadata?.namespace));
}

const ClusterDashboardOverviewPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [namespaces, setNamespaces] = React.useState<string[]>([]);

  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID: id });

  // --- Resource hooks ---
  const { resources: pods } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Pod',
    idAccessor: 'metadata.uid',
  });

  const { resources: deployments } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'apps::v1::Deployment',
    idAccessor: 'metadata.uid',
  });

  const { resources: statefulSets } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'apps::v1::StatefulSet',
    idAccessor: 'metadata.uid',
  });

  const { resources: daemonSets } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'apps::v1::DaemonSet',
    idAccessor: 'metadata.uid',
  });

  const { resources: jobs } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'batch::v1::Job',
    idAccessor: 'metadata.uid',
  });

  const { resources: cronJobs } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'batch::v1::CronJob',
    idAccessor: 'metadata.uid',
  });

  const { resources: nodes } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Node',
    idAccessor: 'metadata.uid',
  });

  const { resources: events } = useResources({
    pluginID: 'kubernetes',
    connectionID: id,
    resourceKey: 'core::v1::Event',
    idAccessor: 'metadata.uid',
  });

  // --- Extension point for dashboard widgets ---
  const widgetEP = useExtensionPoint<{ pluginID: string; connectionID: string }>('omniview/dashboard/widget');
  const widgets = widgetEP?.list() ?? [];

  // --- Pod stats ---
  const podStats = React.useMemo(() => {
    const all = filterByNamespace(pods.data?.result ?? [], namespaces);
    const counts = { Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
    for (const p of all) {
      const phase = p.status?.phase ?? 'Unknown';
      if (phase in counts) {
        counts[phase as keyof typeof counts]++;
      } else {
        counts.Unknown++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Running', count: counts.Running, color: 'success' as const },
        { label: 'Pending', count: counts.Pending, color: 'warning' as const },
        { label: 'Failed', count: counts.Failed, color: 'danger' as const },
        { label: 'Succeeded', count: counts.Succeeded, color: 'neutral' as const },
        { label: 'Unknown', count: counts.Unknown, color: 'neutral' as const },
      ],
    };
  }, [pods.data, namespaces]);

  // --- Deployment stats ---
  const deployStats = React.useMemo(() => {
    const all = filterByNamespace(deployments.data?.result ?? [], namespaces);
    let ready = 0;
    let unavailable = 0;
    for (const d of all) {
      const avail = d.status?.availableReplicas ?? 0;
      const desired = d.spec?.replicas ?? 0;
      if (avail >= desired && desired > 0) {
        ready++;
      } else {
        unavailable++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Unavailable', count: unavailable, color: 'danger' as const },
      ],
    };
  }, [deployments.data, namespaces]);

  // --- StatefulSet stats ---
  const stsStats = React.useMemo(() => {
    const all = filterByNamespace(statefulSets.data?.result ?? [], namespaces);
    let ready = 0;
    let notReady = 0;
    for (const s of all) {
      const readyReplicas = s.status?.readyReplicas ?? 0;
      const desired = s.spec?.replicas ?? 0;
      if (readyReplicas >= desired && desired > 0) {
        ready++;
      } else {
        notReady++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Not Ready', count: notReady, color: 'danger' as const },
      ],
    };
  }, [statefulSets.data, namespaces]);

  // --- DaemonSet stats ---
  const dsStats = React.useMemo(() => {
    const all = filterByNamespace(daemonSets.data?.result ?? [], namespaces);
    let ready = 0;
    let notReady = 0;
    for (const d of all) {
      const desired = d.status?.desiredNumberScheduled ?? 0;
      const numberReady = d.status?.numberReady ?? 0;
      if (numberReady >= desired && desired > 0) {
        ready++;
      } else {
        notReady++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Ready', count: ready, color: 'success' as const },
        { label: 'Not Ready', count: notReady, color: 'danger' as const },
      ],
    };
  }, [daemonSets.data, namespaces]);

  // --- Job stats ---
  const jobStats = React.useMemo(() => {
    const all = filterByNamespace(jobs.data?.result ?? [], namespaces);
    let complete = 0;
    let active = 0;
    let failed = 0;
    for (const j of all) {
      const conditions = j.status?.conditions ?? [];
      const isComplete = conditions.some((c: any) => c.type === 'Complete' && c.status === 'True');
      const isFailed = conditions.some((c: any) => c.type === 'Failed' && c.status === 'True');
      if (isComplete) {
        complete++;
      } else if (isFailed) {
        failed++;
      } else {
        active++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Complete', count: complete, color: 'success' as const },
        { label: 'Active', count: active, color: 'warning' as const },
        { label: 'Failed', count: failed, color: 'danger' as const },
      ],
    };
  }, [jobs.data, namespaces]);

  // --- CronJob stats ---
  const cronJobStats = React.useMemo(() => {
    const all = filterByNamespace(cronJobs.data?.result ?? [], namespaces);
    let activeCount = 0;
    let suspended = 0;
    for (const cj of all) {
      if (cj.spec?.suspend) {
        suspended++;
      } else {
        activeCount++;
      }
    }
    return {
      total: all.length,
      statuses: [
        { label: 'Active', count: activeCount, color: 'success' as const },
        { label: 'Suspended', count: suspended, color: 'neutral' as const },
      ],
    };
  }, [cronJobs.data, namespaces]);

  // --- Filtered data for health banner and events ---
  const allPods = React.useMemo(() => filterByNamespace(pods.data?.result ?? [], namespaces), [pods.data, namespaces]);
  const allNodes = React.useMemo(() => nodes.data?.result ?? [], [nodes.data]);
  const allEvents = React.useMemo(() => filterByNamespace(events.data?.result ?? [], namespaces), [events.data, namespaces]);

  return (
    <Box sx={{ p: 1.5, overflow: 'auto', height: '100%', width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Stack gap={1.5} sx={{ flex: 1, minHeight: 0 }}>
        {/* Cluster info + health status */}
        <ClusterInfoCard
          data={connection.data?.data}
          loading={connection.isLoading}
          nodes={allNodes}
          pods={allPods}
          events={allEvents}
        />

        {/* Namespace filter */}
        <Stack direction='row' alignItems='center' gap={1}>
          <Typography level='body-sm' sx={{ color: 'text.secondary' }}>Namespace:</Typography>
          <NamespaceSelect connectionID={id} selected={namespaces} setNamespaces={setNamespaces} />
        </Stack>

        {/* Workload summary cards — 6 columns */}
        <Grid container spacing={1.5}>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='Pods'
              icon={<LuContainer size={14} />}
              total={podStats.total}
              statuses={podStats.statuses}
              loading={pods.isLoading}
            />
          </Grid>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='Deployments'
              icon={<LuBox size={14} />}
              total={deployStats.total}
              statuses={deployStats.statuses}
              loading={deployments.isLoading}
            />
          </Grid>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='StatefulSets'
              icon={<LuDatabase size={14} />}
              total={stsStats.total}
              statuses={stsStats.statuses}
              loading={statefulSets.isLoading}
            />
          </Grid>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='DaemonSets'
              icon={<LuNetwork size={14} />}
              total={dsStats.total}
              statuses={dsStats.statuses}
              loading={daemonSets.isLoading}
            />
          </Grid>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='Jobs'
              icon={<LuListChecks size={14} />}
              total={jobStats.total}
              statuses={jobStats.statuses}
              loading={jobs.isLoading}
            />
          </Grid>
          <Grid xs={12} sm={6} md={2}>
            <WorkloadSummaryCard
              title='CronJobs'
              icon={<LuCalendarClock size={14} />}
              total={cronJobStats.total}
              statuses={cronJobStats.statuses}
              loading={cronJobs.isLoading}
            />
          </Grid>
        </Grid>

        {/* Extension widget slot */}
        {widgets.length > 0 && (
          <Grid container spacing={1.5}>
            {widgets.map((w) => {
              const Component = w.component as unknown as React.FC<{ pluginID: string; connectionID: string }>;
              return (
                <Grid key={w.id} xs={12} sm={6} md={4}>
                  <Component pluginID='kubernetes' connectionID={id} />
                </Grid>
              );
            })}
          </Grid>
        )}

        {/* Recent events — fills remaining space */}
        <Stack gap={0.75} sx={{ flex: 1, minHeight: 0 }}>
          <Typography level='title-sm'>
            Recent Events ({allEvents.length})
          </Typography>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <EventsTable events={allEvents} loading={events.isLoading} />
          </Box>
        </Stack>
      </Stack>
    </Box>
  );
};

export default ClusterDashboardOverviewPage;
