import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import {
  LuBox,
  LuCloud,
  LuServer,
  LuDatabase,
  LuNetwork,
  LuContainer,
  LuGlobe,
  LuShield,
} from 'react-icons/lu';

import {
  AIContextBar,
  AIResourceCard,
  AICommandSuggestion,
  AILogViewer,
  AIDiffView,
  AIMetricSnapshot,
  AIEventList,
  AIResourceTable,
  AIHealthSummary,
  AIStructuredDataViewer,
  AIActionConfirmation,
  AIRelatedResources,
} from '@omniviewdev/ui/ai';

// ─── Helpers ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 5 }}>
      <Typography
        variant="h6"
        sx={{
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--ov-fg-default)',
          mb: 2,
        }}
      >
        {title}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--ov-fg-faint)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        mb: 0.5,
      }}
    >
      {children}
    </Typography>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export default function AIDomainIntegrationPage() {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography
        variant="h5"
        sx={{ fontWeight: 700, color: 'var(--ov-fg-default)', mb: 0.5 }}
      >
        AI Domain Integration
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'var(--ov-fg-muted)', mb: 3 }}>
        Components that bridge AI chat responses with IDE domain features — provider-agnostic.
      </Typography>

      <Divider sx={{ mb: 4 }} />

      {/* ── AIContextBar ── */}
      <Section title="AIContextBar">
        <Label>Kubernetes context</Label>
        <AIContextBar
          provider={{ label: 'Kubernetes', icon: <LuContainer size={12} /> }}
          connection={{ label: 'prod-us-east-1', icon: <LuServer size={12} /> }}
          scope={{ label: 'Namespace', value: 'default' }}
          resource={{ kind: 'Pod', name: 'nginx-abc-123' }}
          onChangeScope={() => alert('Change scope clicked')}
        />
        <Label>AWS context</Label>
        <AIContextBar
          provider={{ label: 'AWS', icon: <LuCloud size={12} /> }}
          connection={{ label: 'prod-account (123456)' }}
          scope={{ label: 'Region', value: 'us-east-1' }}
        />
        <Label>Minimal (provider only)</Label>
        <AIContextBar
          provider={{ label: 'Azure', icon: <LuGlobe size={12} /> }}
        />
      </Section>

      {/* ── AIResourceCard ── */}
      <Section title="AIResourceCard">
        <Label>Full card — Kubernetes Pod (CrashLoopBackOff)</Label>
        <AIResourceCard
          kind="Pod"
          name="nginx-deployment-7c9b8d6f5-x4k2m"
          icon={<LuBox size={14} />}
          iconColor="var(--ov-info-default)"
          scope="production"
          scopeLabel="Namespace"
          status="error"
          statusLabel="CrashLoopBackOff"
          metadata={[
            { label: 'Node', value: 'worker-3' },
            { label: 'Restarts', value: '15' },
          ]}
          onNavigate={() => alert('Navigate to Pod')}
        />
        <Label>AWS EC2 Instance — stopped</Label>
        <AIResourceCard
          kind="EC2 Instance"
          name="i-0abc123def456"
          icon={<LuServer size={14} />}
          iconColor="var(--ov-warning-default)"
          scope="us-east-1"
          scopeLabel="Region"
          status="warning"
          statusLabel="stopped"
        />
        <Label>Compact mode (inline chip)</Label>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13, color: 'var(--ov-fg-default)' }}>
            The issue is with
          </Typography>
          <AIResourceCard kind="Pod" name="nginx" compact icon={<LuBox size={12} />} />
          <Typography sx={{ fontSize: 13, color: 'var(--ov-fg-default)' }}>
            and
          </Typography>
          <AIResourceCard kind="Service" name="nginx-svc" compact icon={<LuNetwork size={12} />} />
        </Box>
      </Section>

      {/* ── AICommandSuggestion ── */}
      <Section title="AICommandSuggestion">
        <Label>Safe command</Label>
        <AICommandSuggestion
          command="kubectl get pods -n production --sort-by=.status.startTime"
          description="Lists all pods in the production namespace, sorted by start time."
          onRun={(cmd: string) => alert(`Run: ${cmd}`)}
        />
        <Label>Dangerous command (with confirmation)</Label>
        <AICommandSuggestion
          command="kubectl delete pod nginx-deployment-7c9b8d6f5-x4k2m -n production"
          description="Deletes the failing pod to trigger a restart."
          dangerous
          dangerMessage="This will terminate the running pod. A new one will be created by the deployment."
          onRun={(cmd: string) => alert(`Executed: ${cmd}`)}
        />
        <Label>AWS CLI</Label>
        <AICommandSuggestion
          command="aws ec2 start-instances --instance-ids i-0abc123def456 --region us-east-1"
          description="Starts the stopped EC2 instance."
          onRun={(cmd: string) => alert(`Run: ${cmd}`)}
        />
      </Section>

      {/* ── AILogViewer ── */}
      <Section title="AILogViewer">
        <AILogViewer
          title="Pod logs: nginx-deployment-7c9b8d6f5-x4k2m"
          lines={[
            { timestamp: '10:23:01', content: 'Starting nginx...', severity: 'info' },
            { timestamp: '10:23:02', content: 'Configuration loaded', severity: 'info' },
            { timestamp: '10:23:03', content: 'Listening on port 80', severity: 'info' },
            { timestamp: '10:23:15', content: 'Connection refused: upstream backend', severity: 'warn' },
            { timestamp: '10:23:16', content: 'Retrying connection (1/3)...', severity: 'info' },
            { timestamp: '10:23:20', content: 'Connection refused: upstream backend', severity: 'warn' },
            { timestamp: '10:23:25', content: 'Retrying connection (2/3)...', severity: 'info' },
            { timestamp: '10:23:30', content: 'Connection refused: upstream backend', severity: 'error' },
            { timestamp: '10:23:30', content: 'Max retries exceeded, shutting down', severity: 'error' },
            { timestamp: '10:23:31', content: 'Process exited with code 1', severity: 'error' },
          ]}
          highlights={[7, 8, 9]}
          maxLines={7}
          onExpand={() => alert('View full logs')}
        />
      </Section>

      {/* ── AIDiffView ── */}
      <Section title="AIDiffView">
        <AIDiffView
          language="yaml"
          title="deployment.yaml"
          before={`apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:1.19
        resources:
          limits:
            memory: "128Mi"
            cpu: "250m"`}
          after={`apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: nginx
        image: nginx:1.25
        resources:
          limits:
            memory: "256Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /healthz
            port: 80`}
          onApply={() => alert('Applied!')}
        />
      </Section>

      {/* ── AIMetricSnapshot ── */}
      <Section title="AIMetricSnapshot">
        <Label>Kubernetes resource metrics</Label>
        <AIMetricSnapshot
          title="Pod Metrics"
          metrics={[
            { label: 'CPU Usage', value: 78, unit: '%', delta: 12.3, deltaDirection: 'up', status: 'warning', sparkline: [45, 52, 60, 55, 72, 78] },
            { label: 'Memory', value: 412, unit: 'Mi', delta: -20, deltaDirection: 'down', status: 'healthy', sparkline: [450, 440, 430, 425, 415, 412] },
            { label: 'Restarts', value: 15, delta: 5, deltaDirection: 'up', status: 'error' },
          ]}
        />
        <Label>AWS cost metrics</Label>
        <AIMetricSnapshot
          title="Monthly Cost"
          columns={4}
          metrics={[
            { label: 'EC2', value: '$1,234', delta: 5.2, deltaDirection: 'up' },
            { label: 'RDS', value: '$567', delta: -2.1, deltaDirection: 'down' },
            { label: 'S3', value: '$89', delta: 0, deltaDirection: 'flat' },
            { label: 'Total', value: '$1,890', delta: 3.1, deltaDirection: 'up', status: 'warning' },
          ]}
        />
      </Section>

      {/* ── AIEventList ── */}
      <Section title="AIEventList">
        <AIEventList
          title="Recent Events"
          events={[
            { type: 'error', reason: 'BackOff', message: 'Back-off restarting failed container', count: 15, source: 'kubelet' },
            { type: 'warning', reason: 'Unhealthy', message: 'Liveness probe failed: connection refused', count: 8, source: 'kubelet' },
            { type: 'info', reason: 'Pulled', message: 'Successfully pulled image "nginx:1.19"', source: 'kubelet' },
            { type: 'info', reason: 'Created', message: 'Created container nginx', source: 'kubelet' },
            { type: 'success', reason: 'Started', message: 'Started container nginx', source: 'kubelet' },
            { type: 'warning', reason: 'FailedScheduling', message: 'Insufficient cpu (3), insufficient memory (2)', source: 'scheduler' },
            { type: 'info', reason: 'Scheduled', message: 'Successfully assigned production/nginx to worker-3', source: 'scheduler' },
          ]}
          maxEvents={4}
          onExpand={() => alert('View all events')}
        />
      </Section>

      {/* ── AIResourceTable ── */}
      <Section title="AIResourceTable">
        <AIResourceTable
          title="Pods in production"
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
            { key: 'restarts', label: 'Restarts' },
            { key: 'age', label: 'Age' },
          ]}
          rows={[
            { name: 'nginx-7c9b8d-x4k2m', status: 'CrashLoopBackOff', restarts: 15, age: '2d' },
            { name: 'nginx-7c9b8d-j9f3n', status: 'Running', restarts: 0, age: '5d' },
            { name: 'redis-master-0', status: 'Running', restarts: 0, age: '12d' },
            { name: 'api-gateway-8f4c2-abc', status: 'Running', restarts: 1, age: '3d' },
          ]}
          onRowClick={(row: Record<string, any>) => alert(`Clicked: ${row.name}`)}
        />
      </Section>

      {/* ── AIHealthSummary ── */}
      <Section title="AIHealthSummary">
        <AIHealthSummary
          title="Cluster Health"
          stats={[
            { label: 'Healthy', value: 42, status: 'healthy' },
            { label: 'Warning', value: 5, status: 'warning' },
            { label: 'Error', value: 2, status: 'error' },
            { label: 'Unknown', value: 1, status: 'unknown' },
          ]}
          breakdowns={[
            { kind: 'Pods', icon: <LuBox size={12} />, total: 35, statuses: { healthy: 30, warning: 3, error: 2 } },
            { kind: 'Services', icon: <LuNetwork size={12} />, total: 10, statuses: { healthy: 9, warning: 1 } },
            { kind: 'Volumes', icon: <LuDatabase size={12} />, total: 5, statuses: { healthy: 3, warning: 1, unknown: 1 } },
          ]}
        />
      </Section>

      {/* ── AIStructuredDataViewer ── */}
      <Section title="AIStructuredDataViewer">
        <Label>YAML — collapsible</Label>
        <AIStructuredDataViewer
          format="yaml"
          title="pod-spec.yaml"
          collapsible
          content={`apiVersion: v1
kind: Pod
metadata:
  name: nginx
  namespace: production
  labels:
    app: nginx
    tier: frontend
spec:
  containers:
  - name: nginx
    image: nginx:1.25
    ports:
    - containerPort: 80`}
          onApply={() => alert('Applied')}
          onEdit={() => alert('Edit')}
        />
        <Label>JSON</Label>
        <AIStructuredDataViewer
          format="json"
          title="config.json"
          content={JSON.stringify({ region: 'us-east-1', instanceType: 't3.medium', tags: { env: 'prod', team: 'platform' } }, null, 2)}
        />
      </Section>

      {/* ── AIActionConfirmation ── */}
      <Section title="AIActionConfirmation">
        {!confirmed ? (
          <AIActionConfirmation
            action="Delete 3 pods in production"
            description="This will terminate the selected pods. New pods will be created by their respective deployments."
            risk="high"
            affectedResources={[
              { kind: 'Pod', name: 'nginx-x4k2m', icon: <LuBox size={12} /> },
              { kind: 'Pod', name: 'nginx-j9f3n', icon: <LuBox size={12} /> },
              { kind: 'Pod', name: 'api-gw-abc', icon: <LuBox size={12} /> },
            ]}
            onConfirm={() => setConfirmed(true)}
            onCancel={() => alert('Cancelled')}
          />
        ) : (
          <Box
            sx={{
              p: 2,
              borderRadius: '8px',
              bgcolor: 'color-mix(in srgb, var(--ov-success-default) 10%, transparent)',
              border: '1px solid var(--ov-success-default)',
              textAlign: 'center',
            }}
          >
            <Typography sx={{ color: 'var(--ov-success-default)', fontSize: 13 }}>
              Action confirmed! (click to reset)
            </Typography>
            <Box
              component="button"
              onClick={() => setConfirmed(false)}
              sx={{
                mt: 1,
                border: 'none',
                bgcolor: 'transparent',
                color: 'var(--ov-fg-muted)',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Reset demo
            </Box>
          </Box>
        )}
        <Label>Low risk</Label>
        <AIActionConfirmation
          action="Scale deployment to 5 replicas"
          risk="low"
          onConfirm={() => alert('Confirmed')}
          onCancel={() => alert('Cancelled')}
        />
        <Label>Critical risk</Label>
        <AIActionConfirmation
          action="Delete namespace 'production'"
          description="This will permanently delete the namespace and ALL resources within it. This action cannot be undone."
          risk="critical"
          affectedResources={[
            { kind: 'Namespace', name: 'production', icon: <LuShield size={12} /> },
          ]}
          onConfirm={() => alert('Confirmed')}
          onCancel={() => alert('Cancelled')}
        />
      </Section>

      {/* ── AIRelatedResources ── */}
      <Section title="AIRelatedResources">
        <AIRelatedResources
          primary={{ kind: 'Deployment', name: 'nginx-deployment', icon: <LuContainer size={14} /> }}
          related={[
            { kind: 'ReplicaSet', name: 'nginx-rs-7c9b8d', relationship: 'manages', icon: <LuBox size={12} /> },
            { kind: 'Pod', name: 'nginx-7c9b8d-x4k2m', relationship: 'manages', icon: <LuBox size={12} /> },
            { kind: 'Pod', name: 'nginx-7c9b8d-j9f3n', relationship: 'manages', icon: <LuBox size={12} /> },
            { kind: 'Service', name: 'nginx-svc', relationship: 'exposes', icon: <LuNetwork size={12} /> },
            { kind: 'ConfigMap', name: 'nginx-config', relationship: 'mounts', icon: <LuDatabase size={12} /> },
          ]}
          onNavigate={(kind: string, name: string) => alert(`Navigate to ${kind}/${name}`)}
        />
      </Section>
    </Box>
  );
}
