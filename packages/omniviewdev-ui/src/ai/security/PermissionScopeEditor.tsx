import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PermissionScope {
  resourceType: string;
  actions: Record<string, boolean>;
}

export interface PermissionScopeEditorProps {
  scopes: PermissionScope[];
  actions: string[];
  onChange: (scopes: PermissionScope[]) => void;
  sx?: SxProps<Theme>;
}

export default function PermissionScopeEditor({
  scopes,
  actions,
  onChange,
  sx,
}: PermissionScopeEditorProps) {
  const handleToggle = (scopeIdx: number, action: string) => {
    const updated = scopes.map((s, i) => {
      if (i !== scopeIdx) return s;
      return {
        ...s,
        actions: { ...s.actions, [action]: !s.actions[action] },
      };
    });
    onChange(updated);
  };

  return (
    <Box
      sx={{
        overflowX: 'auto',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--ov-text-sm)',
          fontFamily: 'var(--ov-font-ui)',
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: '8px 12px',
                fontWeight: 600,
                color: 'var(--ov-fg-muted)',
                borderBottom: '2px solid var(--ov-border-default)',
              }}
            >
              Resource
            </th>
            {actions.map((a) => (
              <th
                key={a}
                style={{
                  textAlign: 'center',
                  padding: '8px 12px',
                  fontWeight: 600,
                  color: 'var(--ov-fg-muted)',
                  borderBottom: '2px solid var(--ov-border-default)',
                  textTransform: 'capitalize',
                }}
              >
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scopes.map((scope, i) => (
            <tr key={scope.resourceType}>
              <td
                style={{
                  padding: '6px 12px',
                  fontFamily: 'var(--ov-font-mono)',
                  fontWeight: 600,
                  color: 'var(--ov-fg-default)',
                  borderBottom: '1px solid var(--ov-border-muted)',
                }}
              >
                {scope.resourceType}
              </td>
              {actions.map((a) => (
                <td
                  key={a}
                  style={{
                    textAlign: 'center',
                    padding: '6px 12px',
                    borderBottom: '1px solid var(--ov-border-muted)',
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={!!scope.actions[a]}
                    onChange={() => handleToggle(i, a)}
                    sx={{ color: 'var(--ov-fg-muted)', p: 0 }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

PermissionScopeEditor.displayName = 'PermissionScopeEditor';
