import React from 'react';

import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import InputBase from '@mui/material/InputBase';
import { styled } from '@mui/material/styles';
import { Avatar } from '@omniviewdev/ui';

import { LuCheck, LuChevronDown, LuChevronRight, LuAtom, LuSearch, LuStar, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu';
import { Link, useParams } from 'react-router-dom';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';

const CATEGORIES = [
  { label: 'All', value: '' },
  { label: 'Cloud', value: 'cloud' },
  { label: 'Database', value: 'database' },
  { label: 'Monitoring', value: 'monitoring' },
  { label: 'Networking', value: 'networking' },
  { label: 'Security', value: 'security' },
  { label: 'DevOps', value: 'devops' },
  { label: 'Development', value: 'development' },
] as const;

const SearchInput = styled(InputBase)({
  fontSize: '0.8125rem',
  width: '100%',
  '& .MuiInputBase-input': {
    padding: '6px 8px 6px 0',
    '&::placeholder': {
      opacity: 0.5,
    },
  },
});

const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
});

const SectionLabel = styled('span')({
  fontSize: '0.6875rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--ov-fg-faint, #8b949e)',
});

const NavItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active?: boolean }>(({ active }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  textDecoration: 'none',
  color: 'inherit',
  backgroundColor: active ? 'rgba(56,139,253,0.15)' : 'transparent',
  borderLeft: active ? '2px solid rgba(56,139,253,0.8)' : '2px solid transparent',
  '&:hover': {
    backgroundColor: active ? 'rgba(56,139,253,0.15)' : 'rgba(255,255,255,0.04)',
  },
}));

const PluginsNav: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { plugins, available } = usePluginManager();
  const [category, setCategory] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [installedOpen, setInstalledOpen] = React.useState(true);
  const [marketplaceOpen, setMarketplaceOpen] = React.useState(true);

  const installedIds = new Set(plugins.data?.map(p => p.id) ?? []);

  const filteredMarketplace = React.useMemo(() => {
    if (!available.data) return [];
    let items = available.data as any[];
    if (category) items = items.filter(p => p.category === category);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.id?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [available.data, category, search]);

  if (available.isLoading && plugins.isLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <LuSearch size={14} color='var(--ov-fg-faint, #8b949e)' style={{ flexShrink: 0 }} />
        <SearchInput
          placeholder='Search plugins...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

      {/* Installed */}
      <SectionHeader onClick={() => setInstalledOpen(!installedOpen)}>
        <SectionLabel>
          Installed{plugins.data?.length ? ` (${plugins.data.length})` : ''}
        </SectionLabel>
        {installedOpen ? <LuChevronDown size={12} color='var(--ov-fg-faint)' /> : <LuChevronRight size={12} color='var(--ov-fg-faint)' />}
      </SectionHeader>
      <Collapse in={installedOpen}>
        <Box sx={{ px: 0.5, pb: 0.5 }}>
          {plugins.data?.map(p => (
            <Link key={p.id} to={`/plugins/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <NavItem active={id === p.id}>
                <Box sx={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {IsImage(p.metadata?.icon) ? (
                    <Avatar
                      size='xs'
                      src={p.metadata.icon}
                      sx={{ borderRadius: '4px', backgroundColor: 'transparent', border: 0, width: 22, height: 22 }}
                    />
                  ) : <Icon name={p.metadata?.icon || ''} size={22} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.metadata?.name}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  <Box component='span' sx={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: 'var(--ov-fg-faint, #8b949e)' }}>
                    {p.metadata?.version}
                  </Box>
                  {p.devMode && <LuAtom size={11} color="var(--ov-warning-default, #d29922)" />}
                </Box>
              </NavItem>
            </Link>
          ))}
        </Box>
      </Collapse>

      {/* Marketplace */}
      <SectionHeader onClick={() => setMarketplaceOpen(!marketplaceOpen)}>
        <SectionLabel>Marketplace</SectionLabel>
        {marketplaceOpen ? <LuChevronDown size={12} color='var(--ov-fg-faint)' /> : <LuChevronRight size={12} color='var(--ov-fg-faint)' />}
      </SectionHeader>
      {marketplaceOpen && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Category dropdown */}
          <Box sx={{ px: 1.5, pb: 0.75, flexShrink: 0 }}>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              displayEmpty
              size='small'
              fullWidth
              sx={{
                fontSize: '0.75rem',
                height: 28,
                '& .MuiSelect-select': { py: 0.25 },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255,255,255,0.1)',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(255,255,255,0.2)',
                },
              }}
            >
              {CATEGORIES.map(cat => (
                <MenuItem key={cat.value} value={cat.value} sx={{ fontSize: '0.75rem' }}>
                  {cat.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          {/* Plugin list */}
          <Box sx={{ flex: 1, overflow: 'auto', px: 0.5 }}>
            {filteredMarketplace.map((plugin: any) => (
              <Link key={plugin.id} to={`/plugins/${plugin.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <NavItem active={id === plugin.id} sx={{ alignItems: 'flex-start', py: '6px' }}>
                  <Box sx={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', mt: '1px' }}>
                    {plugin.icon_url ? (
                      <Avatar size='xs' src={plugin.icon_url} sx={{ borderRadius: '4px', backgroundColor: 'transparent', border: 0, width: 28, height: 28 }} />
                    ) : IsImage(plugin.icon) ? (
                      <Avatar size='xs' src={plugin.icon} sx={{ borderRadius: '4px', backgroundColor: 'transparent', border: 0, width: 28, height: 28 }} />
                    ) : <Icon name={plugin.icon || ''} size={28} />}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box component='span' sx={{ fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {plugin.name}
                      </Box>
                      {installedIds.has(plugin.id) && (
                        <LuCheck size={12} color='var(--ov-success-default, #3fb950)' style={{ flexShrink: 0 }} />
                      )}
                    </Box>
                    <Box sx={{
                      fontSize: '0.6875rem',
                      color: 'var(--ov-fg-faint, #8b949e)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      mt: '1px',
                    }}>
                      {plugin.description}
                    </Box>
                    {(plugin.average_rating > 0 || plugin.download_count > 0) && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: '2px' }}>
                        {plugin.average_rating > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <LuStar size={10} fill='#f5c518' color='#f5c518' />
                            <Box component='span' sx={{ fontSize: '0.625rem', color: 'var(--ov-fg-faint)' }}>
                              {plugin.average_rating.toFixed(1)}
                            </Box>
                          </Box>
                        )}
                        {plugin.download_count > 0 && (
                          <Box component='span' sx={{ fontSize: '0.625rem', color: 'var(--ov-fg-faint)' }}>
                            {formatDownloads(plugin.download_count)}
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                </NavItem>
              </Link>
            ))}
            {filteredMarketplace.length === 0 && !available.isLoading && !available.isError && (
              <Box sx={{ px: 1.5, py: 2, textAlign: 'center', fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)' }}>
                No plugins found
              </Box>
            )}
            {available.isError && (
              <Box sx={{ px: 1.5, py: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <LuTriangleAlert size={18} color='var(--ov-warning-default, #d29922)' />
                <Box sx={{ fontSize: '0.75rem', color: 'var(--ov-fg-faint, #8b949e)', textAlign: 'center' }}>
                  Could not reach marketplace
                </Box>
                <Box
                  component='button'
                  onClick={() => available.refetch()}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    fontSize: '0.6875rem', color: 'rgba(56,139,253,0.9)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    '&:hover': { color: 'rgba(56,139,253,1)' },
                  }}
                >
                  <LuRefreshCw size={11} />
                  Retry
                </Box>
              </Box>
            )}
            {available.isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={18} />
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export default PluginsNav;
