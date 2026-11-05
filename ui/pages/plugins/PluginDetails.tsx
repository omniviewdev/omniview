import { useState, type FC } from 'react';

import { Avatar, Button, Chip, Heading, IconButton, Menu, Stack, Tabs, Text, useTheme } from '@omniviewdev/base-ui';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import { useParams, useNavigate } from 'react-router';
import { LuDownload, LuEllipsis, LuExternalLink } from 'react-icons/lu';
import { usePluginManager, usePlugin } from '@/hooks/plugin/usePluginManager';
import { Browser } from '@omniviewdev/runtime/runtime';
import PluginUpdateButton from './PluginUpdateButton';
import UninstallPluginModal from './UninstallPluginModal';
import PluginChangelog from './sections/PluginChangelog';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';
import StarRating from './StarRating';
import markdownStyles from './PluginMarkdown.module.css';
import styles from './PluginDetails.module.css';
import { orFallback } from '@/utils/orFallback';
import { connectionProfilesPath } from '@/features/workspace/pagePaths';
import { orderedVersions } from './versionPolicy';
import { usePluginService } from '@/features/plugins';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'versions', label: 'Versions' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'changelog', label: 'Changelog' },
] as const;
const BUILTIN_TABS = [TABS[0]] as const;

const PluginDetails: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { activeTheme } = useTheme();
  const navigate = useNavigate();
  const { plugins, available } = usePluginManager();
  const { plugins: frontendPlugins } = usePluginService();
  const [activeTab, setActiveTab] = useState('overview');
  const { readme, reviews, releaseHistory, uninstall, reload, operation, setEnabled } = usePlugin({
    id, tab: activeTab, installed: false,
  });
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);

  const installed = plugins.data?.find(p => p.id === id);
  const builtin = installed?.origin === 'builtin';
  const frontendState = frontendPlugins.get(id);
  const builtinFailed = builtin && (installed.phase === 'Failed' || frontendState?.phase === 'error');
  const builtinError = orFallback(frontendState?.error, installed?.lastError);
  const startupError = builtin ? builtinError : installed?.lastError;
  const canRetryStartup = !!installed && (builtin ? installed.enabled && builtinFailed : installed.phase !== 'Running');
  const showStartupStatus = !!installed && (
    (builtin && !!operation) || !!startupError || canRetryStartup
  );
  const marketplace = builtin ? undefined : available.data?.find(p => p.id === id);
  const visibleTabs = builtin ? BUILTIN_TABS : TABS;
  const selectedTab = visibleTabs.some(tab => tab.key === activeTab) ? activeTab : 'overview';

  // Derive display values from marketplace data or installed metadata
  const displayName = orFallback(orFallback(marketplace?.name, installed?.metadata?.name), id);
  const displayDescription = orFallback(orFallback(marketplace?.description, installed?.metadata?.description), '');
  const displayIcon = orFallback(orFallback(marketplace?.icon_url, installed?.metadata?.icon), '');
  const displayVersion = orFallback(orFallback(installed?.metadata?.version, marketplace?.latest_version), '');
  const displayCategory = orFallback(orFallback(marketplace?.category, (installed?.metadata as any)?.category), '');
  const displayLicense = orFallback(orFallback(marketplace?.license, (installed?.metadata as any)?.license), '');
  const displayRepository = orFallback(orFallback(marketplace?.repository, installed?.metadata?.repository), '');

  if (plugins.isLoading || available.isLoading) {
    return <div className={styles.NotFound} role='status'>Loading plugin…</div>;
  }

  if (!marketplace && !installed && (plugins.isError || available.isError)) {
    return <div className={styles.NotFound} role='alert'>Could not load plugin. <Button onClick={() => {
      void plugins.refetch(); void available.refetch(); 
    }}>Retry</Button></div>;
  }

  if (!marketplace && !installed) {
    return (
      <div className={styles.NotFound}>
        <Text size='sm' tone='muted'>Plugin not found</Text>
      </div>
    );
  }

  return (
    <div className={styles.Root}>
      {/* Plugin header */}
      <div className={styles.Header}>
        {/* Icon */}
        <div className={styles.IconBox}>
          {displayIcon && IsImage(displayIcon) ? (
            <Avatar
              src={displayIcon}
              alt={displayName}
              shape='rounded'
              className={`${styles.Avatar} ${styles.AvatarImage}`}
            />
          ) : displayIcon ? (
            <Icon name={displayIcon} size={48} />
          ) : (
            <Avatar shape='rounded' className={styles.Avatar} fallback={displayName[0]} />
          )}
        </div>

        {/* Info */}
        <div className={styles.Info}>
          <Stack direction='row' spacing={2} align='center' wrap>
            <Heading level={3}>{displayName}</Heading>
            {displayVersion && (
              <Chip size='sm' color='brand' variant='soft' className={styles.HeaderChip}>{displayVersion}</Chip>
            )}
            {builtin && <Chip size='sm' color='brand' variant='soft'>Built-in · Product managed</Chip>}
            {builtin && <Chip size='sm' color={!installed.enabled ? 'neutral' : builtinFailed ? 'danger' : 'success'} variant='soft'>
              {!installed.enabled ? 'Disabled' : builtinFailed ? 'Failed' : installed.phase}
            </Chip>}
            {marketplace?.official && (
              <Chip size='sm' color='success' variant='soft' className={styles.HeaderChip}>Official</Chip>
            )}
          </Stack>

          <Text as='p' size='sm' tone='muted' className={styles.Description}>
            {displayDescription}
          </Text>
          {builtin && <Text as='p' size='sm' tone='muted'>Included with Omniview. Updates ship with the application.</Text>}

          {/* Metadata row */}
          <Stack direction='row' spacing={4} align='center' wrap className={styles.MetaRow}>
            {displayCategory && (
              <Chip size='xs' color='neutral' variant='outline'>{displayCategory}</Chip>
            )}
            {displayLicense && (
              <Text size='xs' tone='muted'>{displayLicense}</Text>
            )}
            <Stack direction='row' spacing={1} align='center'>
              <StarRating
                value={marketplace?.average_rating ?? 0}
                precision={0.5}
                size={13}
              />
              <Text size='xs' tone='muted'>
                ({marketplace?.review_count ?? 0})
              </Text>
            </Stack>
            {marketplace && marketplace.download_count > 0 && (
              <Stack direction='row' spacing={1} align='center'>
                <LuDownload size={12} />
                <Text size='xs' tone='muted'>
                  {formatDownloads(marketplace.download_count)}
                </Text>
              </Stack>
            )}
            {displayRepository && (
              <button
                type='button'
                className={styles.RepoLink}
                onClick={() => {
                  void Browser.OpenURL(displayRepository);
                }}
              >
                <LuExternalLink size={12} />
                <Text size='xs' tone='muted'>Repository</Text>
              </button>
            )}
          </Stack>
        </div>
        <Menu.Root>
          <Menu.Trigger render={
            <IconButton size='sm' variant='ghost' aria-label='Plugin actions'>
              <LuEllipsis />
            </IconButton>
          } />
          <Menu.Portal>
            <Menu.Positioner side='bottom' align='end' sideOffset={4}>
              <Menu.Popup>
                <Menu.Item onClick={() => {
                  void navigate(`/developer-tools/extensions?plugin=${encodeURIComponent(id)}`);
                }}>Inspect contributions</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        {installed && (
          <Stack direction='row' spacing={2} align='center' wrap className={styles.HeaderActions}>
            {builtin && (
              <Button variant='outline' size='sm' disabled={!!operation || setEnabled.isPending} onClick={() => {
                setEnabled.mutate(!installed.enabled);
              }}>
                {setEnabled.isPending ? 'Saving…' : !installed.enabled ? 'Enable' : 'Disable'}
              </Button>
            )}
            {!!installed && <Button variant="outline" size="sm" onClick={(): void | Promise<void> => navigate(connectionProfilesPath(id))}>Connection profiles</Button>}
            {!!installed && !builtin && (
              <Button
                variant='outline'
                color='danger'
                size='sm'
                disabled={!!operation}
                onClick={() => {
                  setUninstallModalOpen(true); 
                }}
              >
                Uninstall
              </Button>
            )}
          </Stack>
        )}
      </div>
      {!builtin && (
        <PluginUpdateButton
          key={id}
          pluginID={id}
          installed={!!installed}
          currentVersion={installed?.metadata?.version ?? ''}
        />
      )}

      {!builtin && <UninstallPluginModal
        open={uninstallModalOpen}
        onClose={() => {
          setUninstallModalOpen(false); 
        }}
        name={displayName}
        devMode={!!installed?.devMode}
        uninstall={async () => {
          await uninstall();
          void navigate('/plugins');
        }}
      />}

      {showStartupStatus && <Stack direction='row' spacing={2} align='center' wrap className={styles.StartupStatus}>
        {builtin && operation ? <Text size='sm' role='status'>{operation}</Text> : !builtin && installed?.phase !== 'Running' && <Text size='sm' role='status'>{installed?.phase}</Text>}
        {startupError && <Text size='sm' tone='danger' role='alert'>{startupError}</Text>}
        {canRetryStartup && <Button size='sm' variant='outline' disabled={!!operation} onClick={() => {
          void reload().catch(() => undefined); 
        }}>Retry startup</Button>}
      </Stack>}
      {/* Tabs */}
      <Tabs.Root
        value={selectedTab}
        onValueChange={(value) => {
          setActiveTab(String(value));
        }}
        size='sm'
        variant='flat'
        className={styles.Tabs}
      >
        <Tabs.List>
          {visibleTabs.map(tab => (
            <Tabs.Tab key={tab.key} value={tab.key}>{tab.label}</Tabs.Tab>
          ))}
          <Tabs.Indicator />
        </Tabs.List>
        <div className={styles.TabContent}>
          <Tabs.Panel value='overview'>
            {readme.isError ? <Text role='alert'>Could not load readme. <Button size='sm' variant='ghost' onClick={async () => {
              await readme.refetch();
            }}>Retry</Button></Text> : readme.isLoading ? (
              <Text as='p' size='sm' tone='muted' className={styles.PaddedText}>Loading readme...</Text>
            ) : readme.data ? (
              <div data-color-mode={activeTheme.appearance} className={markdownStyles.Markdown}>
                <MarkdownPreview
                  source={readme.data}
                  style={{ backgroundColor: 'transparent', overflow: 'auto' }}
                />
              </div>
            ) : (
              <Text as='p' size='sm' tone='muted' className={styles.PaddedText}>No details available</Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value='versions'>
            {releaseHistory.isError ? <Text role='alert'>Could not load versions. <Button size='sm' variant='ghost' onClick={async () => {
              await releaseHistory.refetch();
            }}>Retry</Button></Text> : releaseHistory.isLoading ? (
              <Text size='sm' tone='muted'>Loading versions...</Text>
            ) : releaseHistory.data?.length ? (
              <Stack direction='column' spacing={0}>
                {orderedVersions(releaseHistory.data).map((v) => (
                  <div key={v.version} className={styles.Card}>
                    <Stack direction='row' spacing={3} align='center'>
                      <Text weight='semibold'>{v.version}</Text>
                      {v.created_at && (
                        <Text size='xs' tone='muted'>
                          {new Date(v.created_at).toLocaleDateString()}
                        </Text>
                      )}
                    </Stack>
                    {v.capabilities?.length > 0 && (
                      <Stack direction='row' spacing={1} className={styles.CardRow}>
                        {v.capabilities.map((cap: string) => (
                          <Chip key={cap} size='xs' color='neutral' variant='outline'>{cap}</Chip>
                        ))}
                      </Stack>
                    )}
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size='sm' tone='muted'>No version history available</Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value='reviews'>
            {/* Rating summary */}
            <div className={`${styles.Card} ${styles.RatingSummary}`}>
              <Stack direction='row' spacing={4} align='center'>
                <Text size='xl' weight='semibold' className={styles.RatingValue}>{(marketplace?.average_rating ?? 0).toFixed(1)}</Text>
                <StarRating
                  value={marketplace?.average_rating ?? 0}
                  precision={0.5}
                  size={20}
                />
                <Text size='sm' tone='muted'>
                  {marketplace?.review_count ?? 0} {(marketplace?.review_count ?? 0) === 1 ? 'review' : 'reviews'}
                </Text>
              </Stack>
            </div>

            {reviews.isError ? <Text role='alert'>Could not load reviews. <Button size='sm' variant='ghost' onClick={async () => {
              await reviews.refetch();
            }}>Retry</Button></Text> : reviews.isLoading ? (
              <Text size='sm' tone='muted'>Loading reviews...</Text>
            ) : reviews.data?.length ? (
              <Stack direction='column' spacing={0}>
                {reviews.data.map((review: any) => (
                  <div key={review.id} className={styles.Card}>
                    <Stack direction='row' spacing={2} align='center'>
                      <StarRating value={review.rating} size={14} />
                      {review.title && <Text size='sm' weight='semibold'>{review.title}</Text>}
                      {review.created_at && (
                        <Text size='xs' tone='muted'>
                          {new Date(review.created_at).toLocaleDateString()}
                        </Text>
                      )}
                    </Stack>
                    {review.body && (
                      <Text as='p' size='sm' className={styles.CardRow}>{review.body}</Text>
                    )}
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size='sm' tone='muted'>No reviews yet</Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value='changelog'>
            {activeTab === 'changelog' && <PluginChangelog id={id} />}
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </div>
  );
};

function formatDownloads(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }

  return count.toString();
}

export default PluginDetails;
