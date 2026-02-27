import React from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { styled, keyframes } from '@mui/material/styles';
import { Avatar } from '@omniviewdev/ui';

import { LuAtom, LuCheck, LuDownload, LuStar, LuSettings } from 'react-icons/lu';
import { Link } from 'react-router-dom';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';

// Phase dot pulse animation
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

type PhaseStatus = 'Running' | 'Failed' | 'Starting' | 'Building' | 'Recovering' | 'Stopped' | 'Validating' | string;

const PHASE_COLORS: Record<string, string> = {
  Running: '#3fb950',
  Failed: '#f85149',
  Starting: '#d29922',
  Building: '#d29922',
  Recovering: '#d29922',
  Validating: '#d29922',
  Stopped: '#8b949e',
};

const TRANSIENT_PHASES = new Set(['Starting', 'Building', 'Recovering', 'Validating']);

const ItemRoot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active?: boolean }>(({ active }) => ({
  display: 'flex',
  gap: 10,
  padding: '6px 12px',
  cursor: 'pointer',
  textDecoration: 'none',
  color: 'inherit',
  backgroundColor: active ? 'rgba(56,139,253,0.15)' : 'transparent',
  borderLeft: active ? '2px solid rgba(56,139,253,0.8)' : '2px solid transparent',
  '&:hover': {
    backgroundColor: active ? 'rgba(56,139,253,0.15)' : 'rgba(255,255,255,0.04)',
  },
  '&:hover .plugin-item-gear': {
    opacity: 1,
  },
}));

const PhaseDot = styled('span')<{ phase: PhaseStatus }>(({ phase }) => ({
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: '50%',
  backgroundColor: PHASE_COLORS[phase] || '#8b949e',
  flexShrink: 0,
  ...(TRANSIENT_PHASES.has(phase) && {
    animation: `${pulse} 1.5s ease-in-out infinite`,
  }),
}));

export type PluginListItemProps = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  iconUrl?: string;
  active?: boolean;

  // Installed plugin fields
  installed?: boolean;
  version?: string;
  phase?: PhaseStatus;
  devMode?: boolean;
  author?: string;

  // Marketplace fields
  publisherName?: string;
  downloadCount?: number;
  averageRating?: number;

  // Actions
  onInstall?: () => void;
  installing?: boolean;
};

const PluginListItem: React.FC<PluginListItemProps> = ({
  id,
  name,
  description,
  icon,
  iconUrl,
  active,
  installed,
  version,
  phase,
  devMode,
  author,
  publisherName,
  downloadCount,
  averageRating,
  onInstall,
  installing,
}) => {
  const displayAuthor = author || publisherName || '';
  const showPhase = installed && phase;

  return (
    <Link to={`/plugins/${id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <ItemRoot active={active}>
        {/* Icon */}
        <Box sx={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mt: '1px',
        }}>
          {iconUrl ? (
            <Avatar
              size='xs'
              src={iconUrl}
              sx={{ borderRadius: '6px', backgroundColor: 'transparent', border: 0, width: 36, height: 36 }}
            />
          ) : icon && IsImage(icon) ? (
            <Avatar
              size='xs'
              src={icon}
              sx={{ borderRadius: '6px', backgroundColor: 'transparent', border: 0, width: 36, height: 36 }}
            />
          ) : icon ? (
            <Icon name={icon} size={36} />
          ) : (
            <Box sx={{
              width: 36,
              height: 36,
              borderRadius: '6px',
              backgroundColor: 'rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--ov-fg-faint, #8b949e)',
            }}>
              {name?.[0]?.toUpperCase() || '?'}
            </Box>
          )}
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0, py: '1px' }}>
          {/* Row 1: Name + Action */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 18 }}>
            <Box component='span' sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
              minWidth: 0,
            }}>
              {name}
            </Box>

            {/* Action area */}
            <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {installed ? (
                <>
                  {devMode && (
                    <LuAtom size={11} color="var(--ov-warning-default, #d29922)" />
                  )}
                  {version && (
                    <Box component='span' sx={{
                      fontSize: '0.625rem',
                      fontFamily: 'monospace',
                      color: 'var(--ov-fg-faint, #8b949e)',
                      lineHeight: 1,
                    }}>
                      {version}
                    </Box>
                  )}
                  <Box
                    className='plugin-item-gear'
                    sx={{
                      opacity: 0,
                      transition: 'opacity 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <LuSettings size={12} color='var(--ov-fg-faint, #8b949e)' />
                  </Box>
                </>
              ) : installing ? (
                <CircularProgress size={14} sx={{ color: 'rgba(56,139,253,0.9)' }} />
              ) : onInstall ? (
                installed ? (
                  <LuCheck size={14} color='var(--ov-success-default, #3fb950)' />
                ) : (
                  <Box
                    component='button'
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onInstall();
                    }}
                    sx={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      color: 'rgba(56,139,253,0.9)',
                      background: 'none',
                      border: '1px solid rgba(56,139,253,0.4)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      padding: '1px 8px',
                      lineHeight: '18px',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        backgroundColor: 'rgba(56,139,253,0.1)',
                        borderColor: 'rgba(56,139,253,0.6)',
                      },
                    }}
                  >
                    Install
                  </Box>
                )
              ) : null}
            </Box>
          </Box>

          {/* Row 2: Description */}
          <Box sx={{
            fontSize: '0.6875rem',
            color: 'var(--ov-fg-faint, #8b949e)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.4,
            mt: '1px',
          }}>
            {description || '\u00A0'}
          </Box>

          {/* Row 3: Author + Stats */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mt: '2px',
            fontSize: '0.625rem',
            color: 'var(--ov-fg-faint, #8b949e)',
          }}>
            {showPhase && <PhaseDot phase={phase} />}
            {displayAuthor && (
              <Box component='span' sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 120,
              }}>
                {displayAuthor}
              </Box>
            )}
            {typeof downloadCount === 'number' && downloadCount > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <LuDownload size={9} />
                <span>{formatDownloads(downloadCount)}</span>
              </Box>
            )}
            {typeof averageRating === 'number' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <LuStar size={9} style={{ color: averageRating > 0 ? '#e3b341' : undefined }} />
                <span>{averageRating > 0 ? averageRating.toFixed(1) : '0'}</span>
              </Box>
            )}
          </Box>
        </Box>
      </ItemRoot>
    </Link>
  );
};

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export default PluginListItem;
