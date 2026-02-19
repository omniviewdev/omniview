import React, { useState, useMemo } from 'react';
import { Box, Typography } from '@mui/material';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';
import Icon from '../../components/Icon';
import SearchInput from '../../inputs/SearchInput';

// ---------------------------------------------------------------------------
// Icon catalog
// ---------------------------------------------------------------------------

const lucideIcons = [
  'LuHouse',
  'LuSettings',
  'LuSearch',
  'LuFile',
  'LuFolder',
  'LuTrash',
  'LuPencil',
  'LuPlus',
  'LuMinus',
  'LuCheck',
  'LuX',
  'LuChevronDown',
  'LuChevronRight',
  'LuArrowRight',
  'LuArrowLeft',
  'LuCopy',
  'LuClipboard',
  'LuTerminal',
  'LuCode',
  'LuGitBranch',
  'LuGitCommitHorizontal',
  'LuCloud',
  'LuServer',
  'LuDatabase',
  'LuLock',
  'LuLockOpen',
  'LuEye',
  'LuEyeOff',
  'LuBell',
  'LuMail',
  'LuHeart',
  'LuStar',
  'LuRefreshCw',
  'LuDownload',
  'LuUpload',
  'LuExternalLink',
  'LuLink',
  'LuCalendar',
  'LuClock',
  'LuFilter',
];

const simpleIcons = [
  'SiKubernetes',
  'SiDocker',
  'SiGo',
  'SiTypescript',
  'SiReact',
  'SiAmazonwebservices',
  'SiGithub',
  'SiLinux',
  'SiGrafana',
  'SiPrometheus',
];

const allIcons = [...lucideIcons, ...simpleIcons];

// ---------------------------------------------------------------------------
// Props definition for the PropsTable
// ---------------------------------------------------------------------------

const iconProps = [
  {
    name: 'name',
    type: 'string',
    description: 'Icon identifier. Prefix determines library: "Lu" for Lucide, "Si" for Simple Icons.',
  },
  {
    name: 'size',
    type: 'number',
    default: '16',
    description: 'Icon dimensions in pixels (width and height).',
  },
  {
    name: 'strokeWidth',
    type: 'number',
    default: '1.5 for Lu',
    description: 'Stroke width for Lucide icons. Automatically set to 1.5 for Lu-prefixed icons if not provided.',
  },
  {
    name: 'color',
    type: 'string',
    description: 'CSS color value applied to the icon fill or stroke.',
  },
];

// ---------------------------------------------------------------------------
// Size demo sizes
// ---------------------------------------------------------------------------

const demoSizes = [12, 16, 20, 24, 32];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IconPage() {
  const [search, setSearch] = useState('');

  const filteredIcons = useMemo(() => {
    if (!search.trim()) return allIcons;
    const query = search.toLowerCase();
    return allIcons.filter((name) => name.toLowerCase().includes(query));
  }, [search]);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-semibold)',
          color: 'var(--ov-fg-base)',
          mb: '8px',
        }}
      >
        Icons
      </Typography>
      <Typography
        variant="body1"
        sx={{ color: 'var(--ov-fg-muted)', mb: '24px', maxWidth: 640, lineHeight: 1.6 }}
      >
        The Icon component renders icons from Lucide (Lu) and Simple Icons (Si) by name.
        It automatically applies a default strokeWidth of 1.5 to Lucide icons.
      </Typography>

      <Box sx={{ mb: '24px' }}>
        <ImportStatement code={`import { Icon } from '@omniviewdev/ui'`} />
      </Box>

      {/* ----------------------------------------------------------------
       * Props
       * -------------------------------------------------------------- */}
      <Section title="Props">
        <PropsTable props={iconProps} />
      </Section>

      {/* ----------------------------------------------------------------
       * Size Demo
       * -------------------------------------------------------------- */}
      <Section
        title="Sizes"
        description="The same icon rendered at different sizes to illustrate the size prop."
      >
        <Example title="LuBox at various sizes">
          <div style={{ display: 'flex', alignItems: 'end', gap: 24 }}>
            {demoSizes.map((size) => (
              <div
                key={size}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Icon name="LuBox" size={size} />
                <span
                  style={{
                    fontFamily: 'var(--ov-font-mono)',
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-muted)',
                  }}
                >
                  {size}px
                </span>
              </div>
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Icon Browser
       * -------------------------------------------------------------- */}
      <Section
        title="Icon Browser"
        description="Search and browse available icons. Type to filter by name."
      >
        <Box sx={{ mb: '16px' }}>
          <SearchInput
            placeholder="Search icons..."
            value={search}
            onChange={setSearch}
          />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 80px)',
            gap: '4px',
          }}
        >
          {filteredIcons.map((name) => (
            <Box
              key={name}
              sx={{
                width: 80,
                height: 80,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                borderRadius: 'var(--ov-radius-md)',
                cursor: 'default',
                '&:hover': {
                  bgcolor: 'var(--ov-state-hover)',
                },
              }}
            >
              <Icon name={name} size={20} />
              <span
                style={{
                  fontFamily: 'var(--ov-font-mono)',
                  fontSize: '9px',
                  color: 'var(--ov-fg-muted)',
                  textAlign: 'center',
                  lineHeight: 1.2,
                  maxWidth: 72,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </span>
            </Box>
          ))}

          {filteredIcons.length === 0 && (
            <Box sx={{ gridColumn: '1 / -1', py: 4, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'var(--ov-fg-faint)' }}>
                No icons match "{search}"
              </Typography>
            </Box>
          )}
        </Box>
      </Section>
    </Box>
  );
}
