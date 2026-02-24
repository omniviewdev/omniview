import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiBadge from '@mui/material/Badge';
import { LuUser, LuBot, LuShield, LuCloud } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import { Avatar } from '@omniviewdev/ui';

const NAMES = ['John Doe', 'Alice Smith', 'Kubernetes', 'Prometheus', 'Grafana', 'arn:aws:eks:us-east-1', 'minikube', 'kind-ia-dev', 'joshuapare-dev', 'sbx-crt'];
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export default function AvatarPage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Avatar
      </Typography>

      <Section
        title="Avatar"
        description="Versatile avatar component with automatic initial extraction, deterministic color hashing from names, image support, custom children, and multiple shapes/sizes. Wraps MUI Avatar with the Omniview design system."
      >
        <ImportStatement code="import { Avatar } from '@omniviewdev/ui';" />

        {/* ---------------------------------------------------------------- */}
        {/* Name → Initials + Color Hash                                     */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Name-Based (Initials + Deterministic Color)" description="Pass a name prop and the avatar automatically extracts initials and generates a consistent background color from a hash of the name. The same name always produces the same initials and color.">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {NAMES.map((name) => (
              <Box key={name} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Avatar name={name} />
                <Typography sx={{ fontSize: '0.625rem', color: 'var(--ov-fg-faint)', maxWidth: 72, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </Typography>
              </Box>
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Initials Logic                                                   */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Initials Extraction Logic" description="Splits on spaces first, then takes first two characters. Handles single words, compound names, and special characters.">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { name: 'John Doe', note: 'J + D (space split)' },
              { name: 'Kubernetes', note: 'KU (first 2 chars)' },
              { name: 'kind-ia-dev', note: 'KI (dash split, when no space)' },
              { name: 'A', note: 'A (single char)' },
            ].map(({ name, note }) => (
              <Box key={name} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Avatar name={name} size="lg" />
                <Typography sx={{ fontSize: '0.6875rem', color: 'var(--ov-fg-muted)', fontWeight: 600 }}>{name}</Typography>
                <Typography sx={{ fontSize: '0.5625rem', color: 'var(--ov-fg-faint)' }}>{note}</Typography>
              </Box>
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Sizes                                                            */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Sizes" description="xs (24px), sm (32px), md (40px), lg (48px), xl (64px). Font size scales proportionally.">
          <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'end' }}>
            {SIZES.map((s) => (
              <Box key={s} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Avatar name="Josh Pare" size={s} />
                <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', fontWeight: 600 }}>{s}</Typography>
              </Box>
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Shapes                                                           */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Shapes" description="'rounded' (default) uses size-proportional border-radius for a rounded square. 'circular' gives a full circle.">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Avatar name="Rounded" size="lg" variant="rounded" />
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>rounded</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <Avatar name="Circular" size="lg" variant="circular" />
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>circular</Typography>
            </Box>
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* From Image                                                       */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Image Source" description="When src is provided, the image is displayed. The name is used for alt text. If the image fails to load, it falls back to initials.">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Avatar src="https://avatars.githubusercontent.com/u/1?v=4" name="GitHub User" />
            <Avatar src="https://avatars.githubusercontent.com/u/2?v=4" name="Second User" size="lg" />
            <Avatar src="https://this-will-fail.invalid/img.png" name="Fallback User" />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Custom Children                                                  */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Custom Children" description="Pass children to render custom content inside the avatar, overriding the auto-generated initials. Useful for icons, emoji, or custom text.">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Avatar size="md" sx={{ bgcolor: 'var(--ov-accent)' }}>
              <LuUser size={20} />
            </Avatar>
            <Avatar size="md" sx={{ bgcolor: 'var(--ov-success-default)' }}>
              <LuBot size={20} />
            </Avatar>
            <Avatar size="md" sx={{ bgcolor: 'var(--ov-warning-default)' }}>
              <LuShield size={20} />
            </Avatar>
            <Avatar size="md" sx={{ bgcolor: 'var(--ov-info-default)' }}>
              <LuCloud size={20} />
            </Avatar>
            <Avatar size="md" sx={{ bgcolor: '#9C27B0' }}>
              K8s
            </Avatar>
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* With Status Badge                                                */}
        {/* ---------------------------------------------------------------- */}
        <Example title="With Status Badge" description="Wrap Avatar in MUI Badge to show online/offline status indicators — common pattern for connection states.">
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <MuiBadge
                overlap="rectangular"
                variant="dot"
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                sx={{ '& .MuiBadge-dot': { bgcolor: 'var(--ov-success-default)', width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--ov-bg-surface)' } }}
              >
                <Avatar name="minikube" size="md" />
              </MuiBadge>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Connected</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <MuiBadge
                overlap="rectangular"
                variant="dot"
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                sx={{ '& .MuiBadge-dot': { bgcolor: 'var(--ov-warning-default)', width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--ov-bg-surface)' } }}
              >
                <Avatar name="kind-ia-dev" size="md" />
              </MuiBadge>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Connecting</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
              <MuiBadge
                overlap="rectangular"
                variant="dot"
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                sx={{ '& .MuiBadge-dot': { bgcolor: 'var(--ov-danger-default)', width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--ov-bg-surface)' } }}
              >
                <Avatar name="prod-east-1" size="md" />
              </MuiBadge>
              <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>Error</Typography>
            </Box>
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Avatar Group / Stack                                             */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Avatar Group" description="Stack avatars with negative margin to create an overlapping group — useful for showing team members or active connections.">
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'].map((name, i) => (
              <Avatar
                key={name}
                name={name}
                size="md"
                sx={{
                  ml: i > 0 ? '-8px' : 0,
                  border: '2px solid var(--ov-bg-surface)',
                  zIndex: 5 - i,
                }}
              />
            ))}
            <Box
              sx={{
                ml: '-8px',
                width: 40,
                height: 40,
                borderRadius: '8px',
                bgcolor: 'var(--ov-bg-surface-inset)',
                border: '2px solid var(--ov-bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--ov-fg-muted)',
              }}
            >
              +3
            </Box>
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Deterministic Color Consistency                                   */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Deterministic Colors" description="Same name always produces the same color. Rendering the same name multiple times confirms consistency.">
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {['minikube', 'minikube', 'minikube', 'home', 'home', 'home', 'arn:aws:eks', 'arn:aws:eks', 'arn:aws:eks'].map((name, i) => (
              <Avatar key={`${name}-${i}`} name={name} size="sm" />
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Real-World: Cluster Connection Card                              */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Real-World: Cluster Connection Card" description="The pattern used in Omniview's cluster hub for displaying connections with deterministic avatars, status badges, and metadata.">
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {[
              { name: 'minikube', connected: true },
              { name: 'kind-ia-dev', connected: false },
              { name: 'arn:aws:eks:us-east-1', connected: true },
              { name: 'joshuapare-dev', connected: false },
            ].map(({ name, connected }) => (
              <Box
                key={name}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.25,
                  py: 0.75,
                  minWidth: 160,
                  maxWidth: 220,
                  borderRadius: 'var(--ov-radius-md)',
                  border: '1px solid var(--ov-border-default)',
                  bgcolor: 'var(--ov-bg-surface)',
                  cursor: 'pointer',
                  '&:hover': { borderColor: 'var(--ov-border-emphasis)', bgcolor: 'var(--ov-bg-surface-hover)' },
                }}
              >
                <MuiBadge
                  overlap="rectangular"
                  variant="dot"
                  invisible={!connected}
                  anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                  sx={{ '& .MuiBadge-dot': { bgcolor: 'var(--ov-success-default)', width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--ov-bg-surface)' } }}
                >
                  <Avatar name={name} size="sm" />
                </MuiBadge>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ov-fg-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Fallback                                                         */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Fallback (No Name, No Source)" description="Without name or src, renders MUI Avatar's default person icon.">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Avatar />
            <Avatar size="lg" />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Props Table                                                      */}
        {/* ---------------------------------------------------------------- */}
        <PropsTable
          props={[
            { name: 'src', type: 'string', description: 'Image source URL. Takes precedence over name/children.' },
            { name: 'name', type: 'string', description: 'Name for automatic initials extraction and deterministic color generation.' },
            { name: 'size', type: 'ComponentSize', default: "'md'", description: "Avatar dimensions: xs (24px), sm (32px), md (40px), lg (48px), xl (64px)." },
            { name: 'variant', type: "'circular' | 'rounded'", default: "'rounded'", description: 'Shape of the avatar. Rounded gives a size-proportional border-radius.' },
            { name: 'children', type: 'ReactNode', description: 'Custom content to render inside (icons, emoji, text). Overrides name-based initials.' },
            { name: 'color', type: 'SemanticColor', description: 'Explicit semantic background color (unused when src is provided).' },
            { name: 'sx', type: 'SxProps<Theme>', description: 'MUI sx overrides for custom styling (bgcolor, border, etc.).' },
          ]}
        />
      </Section>
    </Box>
  );
}
