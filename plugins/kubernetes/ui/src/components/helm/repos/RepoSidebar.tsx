import React from 'react';

// material-ui
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import Grid from '@mui/joy/Grid';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// icons
import { LuRefreshCw, LuLink, LuShieldCheck, LuShieldOff } from 'react-icons/lu';

// project-imports
import { DrawerContext, useExecuteAction } from '@omniviewdev/runtime';

// ── types ──
type HelmRepo = Record<string, any>;

interface Props {
  ctx: DrawerContext<HelmRepo>;
}

const MetaEntry: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Grid container spacing={0}>
    <Grid xs={3}>
      <Typography textColor="neutral.400" level="body-sm">{label}</Typography>
    </Grid>
    <Grid xs={9}>
      <Typography fontWeight={400} textColor="neutral.100" level="title-sm">
        {value}
      </Typography>
    </Grid>
  </Grid>
);

/**
 * Renders a sidebar for a Helm Repository resource.
 */
export const RepoSidebar: React.FC<Props> = ({ ctx }) => {
  const connectionID = ctx.resource?.connectionID ?? '';
  const repoName = ctx.data?.name ?? ctx.resource?.id ?? '';

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Repository',
  });

  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Card sx={{ '--Card-padding': '12px', borderRadius: 'sm' }} variant="outlined">
        <CardContent>
          <Stack direction="column" spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography level="title-lg">{repoName}</Typography>
              <IconButton
                size="sm"
                variant="outlined"
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
                  <Typography level="body-sm" sx={{ wordBreak: 'break-all' }}>
                    {data.url ?? '—'}
                  </Typography>
                </Stack>
              }
            />
            {data.username && <MetaEntry label="Username" value={data.username} />}
            <MetaEntry
              label="TLS"
              value={
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.insecure_skip_tls_verify ? 'warning' : 'success'}
                  startDecorator={
                    data.insecure_skip_tls_verify
                      ? <LuShieldOff size={12} />
                      : <LuShieldCheck size={12} />
                  }
                >
                  {data.insecure_skip_tls_verify ? 'Insecure' : 'Verified'}
                </Chip>
              }
            />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
};

RepoSidebar.displayName = 'RepoSidebar';
export default RepoSidebar;
