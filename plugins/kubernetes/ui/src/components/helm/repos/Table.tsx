import React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Modal from '@mui/material/Modal';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { Card, Chip } from '@omniviewdev/ui';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { Switch, TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import ResourceTable from '../../shared/table/ResourceTable';
import { DrawerComponent, useExecuteAction } from '@omniviewdev/runtime';
import { LuPlus, LuCheck, LuX, LuPackage, LuChevronDown, LuChevronRight, LuLock } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';
import RepoSidebar from './RepoSidebar';
import { createStandardViews } from '../../shared/sidebar/createDrawerViews';
import { stringToColor } from '../../../utils/color';

const resourceKey = 'helm::v1::Repository';

type HelmRepo = Record<string, any>;
type ChartEntry = { name: string; description: string; version: string; appVersion?: string; icon?: string };

const modalStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90%',
  maxWidth: 560,
  maxHeight: '85vh',
  bgcolor: 'background.paper',
  borderRadius: 2,
  boxShadow: 24,
  p: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

function chartInitials(name: string): string {
  if (!name) return '?';
  const parts = name.includes('-') ? name.split('-') : [name];
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const MiniChartIcon: React.FC<{ icon?: string; name: string }> = ({ icon, name }) => {
  const [failed, setFailed] = React.useState(false);
  if (icon && !failed) {
    return (
      <Box sx={{
        width: 24, height: 24, borderRadius: '4px', flexShrink: 0,
        bgcolor: 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Box
          component="img"
          src={icon}
          alt={name}
          onError={() => setFailed(true)}
          sx={{ width: 20, height: 20, objectFit: 'contain', borderRadius: '3px' }}
        />
      </Box>
    );
  }
  return (
    <Box sx={{
      width: 24, height: 24, borderRadius: '4px', flexShrink: 0,
      bgcolor: stringToColor(name, 1),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: 700, color: '#fff', lineHeight: 1,
    }}>
      {chartInitials(name)}
    </Box>
  );
};

// ─── Add Repository Dialog ──────────────────────────────────────────────────────

type DialogStep = 'input' | 'validating' | 'success' | 'error';

/** Collapsible section for auth fields in the Add Repo dialog. */
const AuthSection: React.FC<{
  username: string;
  password: string;
  insecureSkipTLS: boolean;
  plainHTTP: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onInsecureChange: (v: boolean) => void;
  onPlainHTTPChange: (v: boolean) => void;
}> = ({ username, password, insecureSkipTLS, plainHTTP, onUsernameChange, onPasswordChange, onInsecureChange, onPlainHTTPChange }) => {
  const [expanded, setExpanded] = React.useState(false);
  const hasAuth = username || password || insecureSkipTLS || plainHTTP;

  return (
    <Stack direction="column" spacing={0}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        onClick={() => setExpanded(!expanded)}
        sx={{ cursor: 'pointer', py: 0.5, userSelect: 'none' }}
      >
        {expanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        <LuLock size={11} style={{ opacity: 0.6 }} />
        <Text size="xs" weight="semibold" sx={{ color: 'neutral.400' }}>
          Authentication
        </Text>
        {!expanded && hasAuth && (
          <Chip size="sm" emphasis="soft" color="primary" label="Configured" />
        )}
      </Stack>
      {expanded && (
        <Stack direction="column" spacing={1.5} sx={{ pt: 1, pl: 2.5 }}>
          <TextField
            value={username}
            onChange={onUsernameChange}
            placeholder="Username"
            label="Username"
            size="sm"
            fullWidth
            autoComplete="off"
          />
          <TextField
            value={password}
            onChange={onPasswordChange}
            placeholder="Password or token"
            label="Password"
            size="sm"
            fullWidth
            autoComplete="off"
            type="password"
          />
          <Switch
            checked={insecureSkipTLS}
            onChange={onInsecureChange}
            size="sm"
            color="warning"
            label="Skip TLS verification"
          />
          <Switch
            checked={plainHTTP}
            onChange={onPlainHTTPChange}
            size="sm"
            color="warning"
            label="Use plain HTTP (no TLS)"
          />
        </Stack>
      )}
    </Stack>
  );
};

const AddRepoDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  connectionID: string;
}> = ({ open, onClose, connectionID }) => {
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [insecureSkipTLS, setInsecureSkipTLS] = React.useState(false);
  const [plainHTTP, setPlainHTTP] = React.useState(false);
  const [step, setStep] = React.useState<DialogStep>('input');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [charts, setCharts] = React.useState<ChartEntry[]>([]);
  const [chartFilter, setChartFilter] = React.useState('');

  const { executeAction } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Repository',
  });

  const isOCI = url.trim().startsWith('oci://');

  const reset = () => {
    setName('');
    setUrl('');
    setUsername('');
    setPassword('');
    setInsecureSkipTLS(false);
    setPlainHTTP(false);
    setStep('input');
    setErrorMsg('');
    setCharts([]);
    setChartFilter('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleAdd = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      setErrorMsg('Name and URL are required');
      return;
    }
    // Basic URL validation — allow oci:// scheme
    if (!trimmedUrl.startsWith('oci://')) {
      try {
        new URL(trimmedUrl);
      } catch {
        setErrorMsg('Please enter a valid URL (e.g. https://charts.bitnami.com/bitnami or oci://ghcr.io/my-org)');
        return;
      }
    }

    setStep('validating');
    setErrorMsg('');

    try {
      // Build params with auth fields.
      const params: Record<string, unknown> = {
        name: trimmedName,
        url: trimmedUrl,
      };
      if (username) params.username = username;
      if (password) params.password = password;
      if (insecureSkipTLS) params.insecureSkipTLS = true;
      if (plainHTTP) params.plainHTTP = true;

      await executeAction({
        actionID: 'add',
        id: trimmedName,
        params,
      });

      // For non-OCI repos, fetch the chart list for the success preview.
      if (!trimmedUrl.startsWith('oci://')) {
        try {
          const listResult = await executeAction({
            actionID: 'list-charts',
            id: trimmedName,
          });
          const loaded = (listResult.data?.charts ?? []) as ChartEntry[];
          setCharts(loaded);
        } catch {
          setCharts([]);
        }
      }
      setStep('success');
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '');
      const msg = raw || 'Failed to add repository';
      if (msg.includes('already exists')) {
        setErrorMsg(`Repository "${trimmedName}" already exists`);
      } else if (msg.includes('download index')) {
        setErrorMsg(`Could not reach the repository at ${trimmedUrl}. Please verify the URL is correct and accessible.`);
      } else if (msg.includes('authenticate')) {
        setErrorMsg(`Authentication failed for ${trimmedUrl}. Please check your credentials.`);
      } else {
        setErrorMsg(msg);
      }
      setStep('error');
    }
  };

  const filteredCharts = chartFilter
    ? charts.filter((c) => {
        const n = c.name?.toLowerCase() ?? '';
        const d = c.description?.toLowerCase() ?? '';
        return n.includes(chartFilter.toLowerCase()) || d.includes(chartFilter.toLowerCase());
      })
    : charts;

  /** Shared form fields rendered in both 'input' and 'error' steps. */
  const renderFormFields = () => (
    <Stack direction="column" spacing={1.5}>
      <TextField
        value={name}
        onChange={(v) => { setName(v); setErrorMsg(''); }}
        placeholder="e.g. bitnami"
        label="Name"
        size="sm"
        fullWidth
        autoComplete="off"
      />
      <TextField
        value={url}
        onChange={(v) => { setUrl(v); setErrorMsg(''); }}
        placeholder="e.g. https://charts.bitnami.com/bitnami or oci://ghcr.io/my-org"
        label="URL"
        size="sm"
        fullWidth
        autoComplete="off"
        onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
      />
      {isOCI && (
        <Chip size="sm" emphasis="soft" color="info" label="OCI Registry" />
      )}
      <AuthSection
        username={username}
        password={password}
        insecureSkipTLS={insecureSkipTLS}
        plainHTTP={plainHTTP}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onInsecureChange={setInsecureSkipTLS}
        onPlainHTTPChange={setPlainHTTP}
      />
    </Stack>
  );

  return (
    <Modal open={open} onClose={handleClose}>
      <Box sx={modalStyle}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <SiHelm size={16} />
            <Text weight="semibold" size="md">
              {step === 'success' ? 'Repository Added' : 'Add Helm Repository'}
            </Text>
          </Stack>
          <IconButton size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
            <LuX size={14} />
          </IconButton>
        </Stack>
        <Divider />

        {/* Content */}
        <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, py: 2 }}>
          {step === 'input' && renderFormFields()}

          {step === 'validating' && (
            <Stack direction="column" alignItems="center" spacing={2} sx={{ py: 4 }}>
              <CircularProgress size={28} />
              <Stack direction="column" alignItems="center" spacing={0.5}>
                <Text size="sm" weight="semibold">
                  {isOCI ? 'Connecting to registry...' : 'Validating repository...'}
                </Text>
                <Text size="xs" sx={{ color: 'neutral.400' }}>
                  {isOCI ? `Authenticating with ${url.trim().replace('oci://', '')}` : `Downloading index from ${url.trim()}`}
                </Text>
              </Stack>
            </Stack>
          )}

          {step === 'error' && (
            <Stack direction="column" spacing={2}>
              {renderFormFields()}
              <Card sx={{ p: 1.25, borderRadius: 'sm', borderColor: 'error.main' }} emphasis="outline">
                <Text size="xs" sx={{ color: 'error.light' }}>{errorMsg}</Text>
              </Card>
            </Stack>
          )}

          {step === 'success' && (
            <Stack direction="column" spacing={2}>
              {/* Success banner */}
              <Card sx={{ p: 1.25, borderRadius: 'sm', borderColor: 'success.main' }} emphasis="outline">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{
                    width: 20, height: 20, borderRadius: '50%',
                    bgcolor: 'success.main', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <LuCheck size={12} color="#fff" />
                  </Box>
                  <Stack direction="column" spacing={0}>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <Text size="sm" weight="semibold">{name}</Text>
                      {isOCI && <Chip size="sm" emphasis="soft" color="info" label="OCI" />}
                    </Stack>
                    <Text size="xs" sx={{ color: 'neutral.400' }}>{url}</Text>
                  </Stack>
                </Stack>
              </Card>

              {/* Charts preview — only for traditional repos */}
              {!isOCI && (
                <Stack direction="column" spacing={1}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                      <LuPackage size={13} style={{ opacity: 0.6 }} />
                      <Text size="xs" weight="semibold" sx={{ color: 'neutral.300' }}>
                        {charts.length} chart{charts.length !== 1 ? 's' : ''} available
                      </Text>
                    </Stack>
                    {charts.length > 8 && (
                      <Chip size="sm" emphasis="soft" color="neutral" label={`${filteredCharts.length} shown`} />
                    )}
                  </Stack>

                  {charts.length > 8 && (
                    <TextField
                      value={chartFilter}
                      onChange={setChartFilter}
                      placeholder="Search charts..."
                      size="xs"
                      fullWidth
                      autoComplete="off"
                    />
                  )}

                  <Stack
                    direction="column"
                    spacing={0}
                    sx={{
                      maxHeight: 280,
                      overflow: 'auto',
                      borderRadius: '6px',
                      border: '1px solid',
                      borderColor: 'neutral.800',
                    }}
                  >
                    {filteredCharts.slice(0, 50).map((chart, i) => (
                      <Stack
                        key={chart.name}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          borderBottom: i < filteredCharts.length - 1 ? '1px solid' : 'none',
                          borderColor: 'neutral.800',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <MiniChartIcon icon={chart.icon} name={chart.name} />
                        <Stack direction="column" spacing={0} sx={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" weight="semibold" sx={{ lineHeight: 1.3 }}>{chart.name}</Text>
                          {chart.description && (
                            <Text size="xs" sx={{
                              color: 'neutral.500',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.3,
                            }}>
                              {chart.description}
                            </Text>
                          )}
                        </Stack>
                        <Text size="xs" sx={{ color: 'neutral.500', flexShrink: 0 }}>
                          {chart.version}
                        </Text>
                      </Stack>
                    ))}
                    {filteredCharts.length > 50 && (
                      <Box sx={{ px: 1.25, py: 0.75, textAlign: 'center' }}>
                        <Text size="xs" sx={{ color: 'neutral.500' }}>
                          and {filteredCharts.length - 50} more...
                        </Text>
                      </Box>
                    )}
                    {charts.length === 0 && (
                      <Box sx={{ px: 1.25, py: 2, textAlign: 'center' }}>
                        <Text size="xs" sx={{ color: 'neutral.500' }}>
                          Repository added but no charts found in the index.
                        </Text>
                      </Box>
                    )}
                  </Stack>
                </Stack>
              )}

              {/* OCI success message */}
              {isOCI && (
                <Text size="xs" sx={{ color: 'neutral.400' }}>
                  OCI registry added. Charts from OCI registries are discovered when you reference them directly (e.g. oci://ghcr.io/org/chart-name).
                </Text>
              )}
            </Stack>
          )}
        </Box>

        {/* Footer */}
        <Divider />
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2.5, py: 1.5 }}>
          {step === 'input' && (
            <>
              <Button size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="xs"
                emphasis="solid"
                color="primary"
                onClick={() => void handleAdd()}
              >
                Add Repository
              </Button>
            </>
          )}
          {step === 'error' && (
            <>
              <Button size="xs" emphasis="ghost" color="neutral" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="xs"
                emphasis="solid"
                color="primary"
                onClick={() => void handleAdd()}
              >
                Retry
              </Button>
            </>
          )}
          {step === 'success' && (
            <Button
              size="xs"
              emphasis="solid"
              color="primary"
              onClick={handleClose}
            >
              Done
            </Button>
          )}
        </Stack>
      </Box>
    </Modal>
  );
};


const HelmRepoTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [showAddRepo, setShowAddRepo] = React.useState(false);

  const columns = React.useMemo<Array<ColumnDef<HelmRepo>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 200,
      },
      {
        id: 'type',
        header: 'Type',
        accessorFn: (row) => row.type ?? 'default',
        size: 80,
        cell: ({ getValue }) => {
          const t = getValue<string>();
          return (
            <Chip
              size="sm"
              emphasis="soft"
              color={t === 'oci' ? 'info' : 'neutral'}
              label={t === 'oci' ? 'OCI' : 'HTTP'}
            />
          );
        },
      },
      {
        id: 'url',
        header: 'URL',
        accessorKey: 'url',
        size: 300,
        meta: { flex: 1 },
      },
    ],
    [],
  );

  const drawer: DrawerComponent<HelmRepo> = React.useMemo(() => ({
    title: 'Repository',
    icon: <SiHelm />,
    views: createStandardViews({ SidebarComponent: RepoSidebar }),
    actions: [],
  }), []);

  return (
    <>
      <ResourceTable
        columns={columns}
        connectionID={id}
        resourceKey={resourceKey}
        idAccessor="name"
        memoizer="name"
        drawer={drawer}
        hideNamespaceSelector
        toolbarActions={
          <Button
            size="xs"
            emphasis="outline"
            color="primary"
            startIcon={<LuPlus size={12} />}
            onClick={() => setShowAddRepo(true)}
          >
            Add Repo
          </Button>
        }
      />
      <AddRepoDialog
        open={showAddRepo}
        onClose={() => setShowAddRepo(false)}
        connectionID={id}
      />
    </>
  );
};

export default HelmRepoTable;
