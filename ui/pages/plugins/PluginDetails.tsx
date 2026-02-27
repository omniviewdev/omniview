import { useState, type FC } from 'react';

// Material-ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Rating from '@mui/material/Rating';
import { Stack } from '@omniviewdev/ui/layout';
import { Text, Heading } from '@omniviewdev/ui/typography';
import { Avatar, Chip } from '@omniviewdev/ui';
import { Button } from '@omniviewdev/ui/buttons';
import { Tabs, TabPanel } from '@omniviewdev/ui/navigation';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import { useParams, useNavigate } from 'react-router-dom';
import { LuDownload, LuExternalLink } from 'react-icons/lu';
import { usePluginManager, usePlugin } from '@/hooks/plugin/usePluginManager';
import { BrowserOpenURL } from '@omniviewdev/runtime/runtime';
import PluginUpdateButton from './PluginUpdateButton';
import UninstallPluginModal from './UninstallPluginModal';
import PluginChangelog from './sections/PluginChangelog';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'versions', label: 'Versions' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'changelog', label: 'Changelog' },
] as const;

const PluginDetails: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { plugins, available } = usePluginManager();
  const { readme, reviews, releaseHistory, uninstall } = usePlugin({ id });
  const [activeTab, setActiveTab] = useState('overview');
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);

  const installed = plugins.data?.find(p => p.id === id);
  // marketplace data typed as any until Wails bindings regenerate with new AvailablePlugin fields
  const marketplace: any = available.data?.find((p: any) => p.id === id);

  // Derive display values from marketplace data or installed metadata
  const displayName = marketplace?.name || installed?.metadata?.name || id;
  const displayDescription = marketplace?.description || installed?.metadata?.description || '';
  const displayIcon = marketplace?.icon_url || installed?.metadata?.icon || '';
  const displayVersion = installed?.metadata?.version || marketplace?.latest_version || '';
  const displayCategory = marketplace?.category || (installed?.metadata as any)?.category || '';
  const displayLicense = marketplace?.license || (installed?.metadata as any)?.license || '';
  const displayRepository = marketplace?.repository || installed?.metadata?.repository || '';

  if (!marketplace && !installed) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Text size='sm' sx={{ color: 'text.secondary' }}>Plugin not found</Text>
      </Box>
    );
  }

  return (
    <Box sx={{ maxHeight: 'calc(100vh - 60px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 2.5 }}>
      {/* Plugin header */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
        {/* Icon */}
        <Box sx={{ width: 48, height: 48, flexShrink: 0 }}>
          {displayIcon && IsImage(displayIcon) ? (
            <Avatar
              src={displayIcon}
              sx={{ height: 48, width: 48, borderRadius: 1.5, backgroundColor: 'transparent', border: 0 }}
            />
          ) : displayIcon ? (
            <Icon name={displayIcon} size={48} />
          ) : (
            <Avatar sx={{ height: 48, width: 48, borderRadius: 1.5 }}>{displayName[0]}</Avatar>
          )}
        </Box>

        {/* Info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction='row' spacing={1.5} alignItems='center'>
            <Heading level={3}>{displayName}</Heading>
            {displayVersion && (
              <Chip size='sm' color='primary' label={displayVersion} sx={{ borderRadius: 1, maxHeight: 22 }} />
            )}
            {marketplace?.official && (
              <Chip size='sm' color='success' emphasis='soft' label='Official' sx={{ maxHeight: 22 }} />
            )}
          </Stack>

          <Text size='sm' sx={{ color: 'text.secondary', mt: 0.5 }}>
            {displayDescription}
          </Text>

          {/* Metadata row */}
          <Stack direction='row' spacing={2} alignItems='center' sx={{ mt: 1 }} flexWrap='wrap'>
            {displayCategory && (
              <Chip size='xs' color='neutral' emphasis='outline' label={displayCategory} />
            )}
            {displayLicense && (
              <Text size='xs' sx={{ color: 'text.secondary' }}>{displayLicense}</Text>
            )}
            <Stack direction='row' spacing={0.5} alignItems='center'>
              <Rating
                value={marketplace?.average_rating ?? 0}
                precision={0.5}
                readOnly
                size='small'
                sx={{ fontSize: '0.85rem' }}
              />
              <Text size='xs' sx={{ color: 'text.secondary' }}>
                ({marketplace?.review_count ?? 0})
              </Text>
            </Stack>
            {marketplace?.download_count > 0 && (
              <Stack direction='row' spacing={0.5} alignItems='center'>
                <LuDownload size={12} />
                <Text size='xs' sx={{ color: 'text.secondary' }}>
                  {formatDownloads(marketplace.download_count)}
                </Text>
              </Stack>
            )}
            {displayRepository && (
              <Box
                component='span'
                onClick={() => BrowserOpenURL(displayRepository)}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
              >
                <LuExternalLink size={12} />
                <Text size='xs' sx={{ color: 'text.secondary' }}>Repository</Text>
              </Box>
            )}
          </Stack>
        </Box>

        {/* Install/Update/Uninstall buttons */}
        <Stack direction='row' spacing={1} sx={{ flexShrink: 0, pt: 0.5 }}>
          <PluginUpdateButton
            pluginID={id}
            installed={!!installed}
            currentVersion={installed?.metadata?.version || ''}
          />
          {!!installed && (
            <Button
              emphasis='outline'
              color='danger'
              size='sm'
              onClick={() => setUninstallModalOpen(true)}
            >
              Uninstall
            </Button>
          )}
        </Stack>
      </Box>

      <UninstallPluginModal
        open={uninstallModalOpen}
        onClose={() => setUninstallModalOpen(false)}
        name={displayName}
        devMode={!!installed?.devMode}
        uninstall={() => {
          uninstall().then(() => {
            navigate('/plugins');
          });
        }}
      />

      <Divider />

      {/* Tabs */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Tabs
          tabs={[...TABS]}
          value={activeTab}
          onChange={setActiveTab}
          size='sm'
        />
        <Box sx={{ flex: 1, overflow: 'auto', mt: 1 }}>
          <TabPanel value='overview' activeValue={activeTab}>
            {readme.isLoading ? (
              <Text size='sm' sx={{ color: 'text.secondary', p: 2 }}>Loading readme...</Text>
            ) : readme.data ? (
              <Box
                data-color-mode="dark"
                sx={{
                  '& .wmde-markdown': {
                    backgroundColor: 'transparent !important',
                    fontSize: '0.8125rem',
                    lineHeight: 1.65,
                  },
                  '& .wmde-markdown h1': { fontSize: '1.35rem', mt: 2, mb: 1 },
                  '& .wmde-markdown h2': { fontSize: '1.1rem', mt: 2, mb: 0.75 },
                  '& .wmde-markdown h3': { fontSize: '0.95rem', mt: 1.5, mb: 0.5 },
                  '& .wmde-markdown h4': { fontSize: '0.875rem', mt: 1.5, mb: 0.5 },
                  '& .wmde-markdown p': { fontSize: '0.8125rem', my: 0.75 },
                  '& .wmde-markdown li': { fontSize: '0.8125rem' },
                  '& .wmde-markdown code': { fontSize: '0.75rem' },
                  '& .wmde-markdown table': { fontSize: '0.8125rem' },
                }}
              >
                <MarkdownPreview
                  source={readme.data}
                  style={{ backgroundColor: 'transparent', overflow: 'auto' }}
                />
              </Box>
            ) : (
              <Text size='sm' sx={{ color: 'text.secondary', p: 2 }}>No details available</Text>
            )}
          </TabPanel>

          <TabPanel value='versions' activeValue={activeTab}>
            {releaseHistory.isLoading ? (
              <Text size='sm' sx={{ color: 'text.secondary' }}>Loading versions...</Text>
            ) : releaseHistory.data?.length ? (
              <Stack direction='column' gap={2}>
                {releaseHistory.data.map((v: any) => (
                  <Box
                    key={v.version}
                    sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack direction='row' spacing={1.5} alignItems='center'>
                      <Text weight='semibold'>{v.version}</Text>
                      {v.created_at && (
                        <Text size='xs' sx={{ color: 'text.secondary' }}>
                          {new Date(v.created_at).toLocaleDateString()}
                        </Text>
                      )}
                    </Stack>
                    {v.capabilities?.length > 0 && (
                      <Stack direction='row' spacing={0.5} sx={{ mt: 1 }}>
                        {v.capabilities.map((cap: string) => (
                          <Chip key={cap} size='xs' color='neutral' emphasis='outline' label={cap} />
                        ))}
                      </Stack>
                    )}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Text size='sm' sx={{ color: 'text.secondary' }}>No version history available</Text>
            )}
          </TabPanel>

          <TabPanel value='reviews' activeValue={activeTab}>
            {/* Rating summary */}
            <Box sx={{ mb: 2, p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <Stack direction='row' spacing={2} alignItems='center'>
                <Text size='xl' weight='bold'>{(marketplace?.average_rating ?? 0).toFixed(1)}</Text>
                <Rating
                  value={marketplace?.average_rating ?? 0}
                  precision={0.5}
                  readOnly
                  sx={{ fontSize: '1.25rem' }}
                />
                <Text size='sm' sx={{ color: 'text.secondary' }}>
                  {marketplace?.review_count ?? 0} {(marketplace?.review_count ?? 0) === 1 ? 'review' : 'reviews'}
                </Text>
              </Stack>
            </Box>

            {reviews.isLoading ? (
              <Text size='sm' sx={{ color: 'text.secondary' }}>Loading reviews...</Text>
            ) : reviews.data?.length ? (
              <Stack direction='column' gap={2}>
                {reviews.data.map((review: any) => (
                  <Box
                    key={review.id}
                    sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  >
                    <Stack direction='row' spacing={1} alignItems='center'>
                      <Rating value={review.rating} readOnly size='small' sx={{ fontSize: '0.9rem' }} />
                      {review.title && <Text size='sm' weight='semibold'>{review.title}</Text>}
                      {review.created_at && (
                        <Text size='xs' sx={{ color: 'text.secondary' }}>
                          {new Date(review.created_at).toLocaleDateString()}
                        </Text>
                      )}
                    </Stack>
                    {review.body && (
                      <Text size='sm' sx={{ mt: 1 }}>{review.body}</Text>
                    )}
                  </Box>
                ))}
              </Stack>
            ) : (
              <Text size='sm' sx={{ color: 'text.secondary' }}>No reviews yet</Text>
            )}
          </TabPanel>

          <TabPanel value='changelog' activeValue={activeTab}>
            <PluginChangelog id={id} />
          </TabPanel>
        </Box>
      </Box>
    </Box>
  );
};

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export default PluginDetails;
