import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import MuiIconButton from '@mui/material/IconButton';
import MuiChip from '@mui/material/Chip';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import type { SxProps, Theme } from '@mui/material/styles';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'connected' | 'disconnected' | 'error';
  capabilities?: string[];
}

export interface MCPServerConfigProps {
  servers: MCPServer[];
  onAdd?: () => void;
  onRemove: (id: string) => void;
  sx?: SxProps<Theme>;
}

const statusColors: Record<MCPServer['status'], string> = {
  connected: 'var(--ov-success-default)',
  disconnected: 'var(--ov-fg-faint)',
  error: 'var(--ov-danger-default)',
};

export default function MCPServerConfig({
  servers,
  onAdd,
  onRemove,
  sx,
}: MCPServerConfigProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
          }}
        >
          MCP Servers
        </Typography>
        {onAdd && (
          <MuiButton
            size="small"
            variant="outlined"
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={onAdd}
            sx={{
              textTransform: 'none',
              fontSize: 'var(--ov-text-xs)',
              borderColor: 'var(--ov-border-default)',
              color: 'var(--ov-fg-default)',
            }}
          >
            Add Server
          </MuiButton>
        )}
      </Box>

      {servers.length === 0 ? (
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            color: 'var(--ov-fg-faint)',
            textAlign: 'center',
            py: 3,
            border: '1px dashed var(--ov-border-default)',
            borderRadius: '6px',
          }}
        >
          No MCP servers configured
        </Typography>
      ) : (
        servers.map((server) => (
          <Box
            key={server.id}
            sx={{
              border: '1px solid var(--ov-border-default)',
              borderRadius: '6px',
              bgcolor: 'var(--ov-bg-surface)',
              p: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: statusColors[server.status],
                  flexShrink: 0,
                }}
              />
              <Typography
                sx={{
                  flex: 1,
                  fontSize: 'var(--ov-text-sm)',
                  fontWeight: 600,
                  color: 'var(--ov-fg-default)',
                }}
              >
                {server.name}
              </Typography>
              <MuiIconButton
                size="small"
                onClick={() => onRemove(server.id)}
                sx={{
                  color: 'var(--ov-fg-faint)',
                  '&:hover': { color: 'var(--ov-danger-default)' },
                }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 14 }} />
              </MuiIconButton>
            </Box>

            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-faint)',
                fontFamily: 'var(--ov-font-mono)',
                mb: server.capabilities?.length ? 0.75 : 0,
              }}
            >
              {server.url}
            </Typography>

            {server.capabilities && server.capabilities.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {server.capabilities.map((cap) => (
                  <MuiChip
                    key={cap}
                    label={cap}
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 20,
                      fontSize: '10px',
                      borderColor: 'var(--ov-border-default)',
                      color: 'var(--ov-fg-muted)',
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}

MCPServerConfig.displayName = 'MCPServerConfig';
