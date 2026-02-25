import { useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import {
  PermissionRequest,
  PermissionBadge,
  PermissionScopeEditor,
  SecurityBanner,
  PermissionGate,
} from '@omniviewdev/ui/ai';
import type { PermissionScope } from '@omniviewdev/ui/ai';

const initialScopes: PermissionScope[] = [
  { resourceType: 'pods', actions: { get: true, list: true, create: false, update: false, delete: false, exec: false } },
  { resourceType: 'deployments', actions: { get: true, list: true, create: false, update: true, delete: false, exec: false } },
  { resourceType: 'services', actions: { get: true, list: true, create: false, update: false, delete: false, exec: false } },
  { resourceType: 'secrets', actions: { get: false, list: false, create: false, update: false, delete: false, exec: false } },
];

export default function AISecurityPage() {
  const [permOpen, setPermOpen] = useState(false);
  const [scopes, setScopes] = useState(initialScopes);
  const [gateAllowed, setGateAllowed] = useState(false);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Security & Permissions
      </Typography>

      {/* ---- PermissionRequest ---- */}
      <Section title="PermissionRequest" description="Modal dialog for permission approval with risk-level indicators.">
        <ImportStatement code="import { PermissionRequest } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive">
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" onClick={() => setPermOpen(true)} sx={{ textTransform: 'none' }}>
              Show Permission Request
            </Button>
          </Box>
          <PermissionRequest
            open={permOpen}
            onAllow={(scope) => { alert(`Allowed: ${scope}`); setPermOpen(false); }}
            onDeny={() => setPermOpen(false)}
            request={{
              action: 'Delete Deployment',
              resource: 'deployments',
              connection: 'production-cluster',
              namespace: 'default',
              requestedBy: 'AI Assistant',
              riskLevel: 'danger',
              description: 'This will remove the deployment and all associated pods.',
            }}
          />
        </Example>

        <PropsTable
          props={[
            { name: 'open', type: 'boolean', description: 'Dialog visibility' },
            { name: 'onAllow', type: "(scope: 'once' | 'session' | 'always') => void", description: 'Allow callback' },
            { name: 'onDeny', type: '() => void', description: 'Deny callback' },
            { name: 'request.action', type: 'string', description: 'Action being requested' },
            { name: 'request.riskLevel', type: "'info' | 'warning' | 'danger'", description: 'Risk level' },
            { name: 'request.requestedBy', type: 'string', description: 'Who is requesting' },
          ]}
        />
      </Section>

      {/* ---- PermissionBadge ---- */}
      <Section title="PermissionBadge" description="Small badge showing active permission level.">
        <ImportStatement code="import { PermissionBadge } from '@omniviewdev/ui/ai';" />

        <Example title="All Levels">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <PermissionBadge level="restricted" />
            <PermissionBadge level="read-only" tooltip="Can only read resources" />
            <PermissionBadge level="read-write" tooltip="Can read and modify resources" />
            <PermissionBadge level="full-access" tooltip="Full cluster access" />
          </Box>
        </Example>
      </Section>

      {/* ---- SecurityBanner ---- */}
      <Section title="SecurityBanner" description="Persistent banner showing current security context.">
        <ImportStatement code="import { SecurityBanner } from '@omniviewdev/ui/ai';" />

        <Example title="Security Levels">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <SecurityBanner connection="production-cluster" level="read-only" permissions={['get', 'list']} />
            <SecurityBanner connection="staging-cluster" level="read-write" permissions={['get', 'list', 'create', 'update']} />
            <SecurityBanner connection="dev-cluster" level="full-access" />
            <SecurityBanner connection="locked-cluster" level="restricted" />
          </Box>
        </Example>
      </Section>

      {/* ---- PermissionScopeEditor ---- */}
      <Section title="PermissionScopeEditor" description="Checkbox grid for configuring per-resource permissions.">
        <ImportStatement code="import { PermissionScopeEditor } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive Editor">
          <PermissionScopeEditor
            scopes={scopes}
            actions={['get', 'list', 'create', 'update', 'delete', 'exec']}
            onChange={setScopes}
          />
        </Example>
      </Section>

      {/* ---- PermissionGate ---- */}
      <Section title="PermissionGate" description="Wrapper that shows content only if permitted, otherwise shows placeholder.">
        <ImportStatement code="import { PermissionGate } from '@omniviewdev/ui/ai';" />

        <Example title="Allowed vs Denied">
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', display: 'block', mb: 1 }}>
                Denied
              </Typography>
              <PermissionGate
                allowed={gateAllowed}
                onRequest={() => setGateAllowed(true)}
                message="You need cluster-admin access to view secrets"
              >
                <Box sx={{ p: 2, bgcolor: 'var(--ov-bg-surface)', borderRadius: '6px' }}>
                  <Typography sx={{ color: 'var(--ov-fg-default)' }}>Secret content here</Typography>
                </Box>
              </PermissionGate>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', display: 'block', mb: 1 }}>
                Allowed
              </Typography>
              <PermissionGate allowed>
                <Box sx={{ p: 2, bgcolor: 'var(--ov-bg-surface)', borderRadius: '6px', border: '1px solid var(--ov-success-default)' }}>
                  <Typography sx={{ color: 'var(--ov-fg-default)' }}>Visible secret content</Typography>
                </Box>
              </PermissionGate>
            </Box>
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
