import { useState, type FC } from 'react';

import { Avatar, Button, Chip, Heading, Separator, Stack, Tabs, Text } from '@omniviewdev/base-ui';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';
import { useParams, useNavigate } from 'react-router-dom';
import { LuDownload, LuExternalLink } from 'react-icons/lu';
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
          <Stack direction='row' spacing={3} align='center'>
            <Heading level={3}>{displayName}</Heading>
            {displayVersion && (
              <Chip size='sm' color='brand' variant='soft' className={styles.HeaderChip}>{displayVersion}</Chip>
            )}
            {marketplace?.official && (
              <Chip size='sm' color='success' variant='soft' className={styles.HeaderChip}>Official</Chip>
            )}
          </Stack>

          <Text as='p' size='sm' tone='muted' className={styles.Description}>
            {displayDescription}
          </Text>

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
            {marketplace?.download_count > 0 && (
              <Stack direction='row' spacing={1} align='center'>
                <LuDownload size={12} />
                <Text size='xs' tone='muted'>
                  {formatDownloads(marketplace.download_count)}
                </Text>
              </Stack>
            )}
            {displayRepository && (
              <span
                className={styles.RepoLink}
                onClick={() => Browser.OpenURL(displayRepository)}
              >
                <LuExternalLink size={12} />
                <Text size='xs' tone='muted'>Repository</Text>
              </span>
            )}
          </Stack>
        </div>

        {/* Install/Update/Uninstall buttons */}
        <Stack direction='row' spacing={2} className={styles.HeaderActions}>
          <PluginUpdateButton
            pluginID={id}
            installed={!!installed}
            currentVersion={installed?.metadata?.version || ''}
          />
          {!!installed && (
            <Button
              variant='outline'
              color='danger'
              size='sm'
              onClick={() => {
                setUninstallModalOpen(true); 
              }}
            >
              Uninstall
            </Button>
          )}
        </Stack>
      </div>

      <UninstallPluginModal
        open={uninstallModalOpen}
        onClose={() => {
          setUninstallModalOpen(false); 
        }}
        name={displayName}
        devMode={!!installed?.devMode}
        uninstall={() => {
          uninstall().then(() => {
            navigate('/plugins');
          });
        }}
      />

      <Separator />

      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(String(value));
        }}
        size='sm'
        className={styles.Tabs}
      >
        <Tabs.List>
          {TABS.map(tab => (
            <Tabs.Tab key={tab.key} value={tab.key}>{tab.label}</Tabs.Tab>
          ))}
          <Tabs.Indicator />
        </Tabs.List>
        <div className={styles.TabContent}>
          <Tabs.Panel value='overview'>
            {readme.isLoading ? (
              <Text as='p' size='sm' tone='muted' className={styles.PaddedText}>Loading readme...</Text>
            ) : readme.data ? (
              <div data-color-mode='dark' className={markdownStyles.Markdown}>
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
            {releaseHistory.isLoading ? (
              <Text size='sm' tone='muted'>Loading versions...</Text>
            ) : releaseHistory.data?.length ? (
              <Stack direction='column' spacing={4}>
                {releaseHistory.data.map((v: any) => (
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

            {reviews.isLoading ? (
              <Text size='sm' tone='muted'>Loading reviews...</Text>
            ) : reviews.data?.length ? (
              <Stack direction='column' spacing={4}>
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
            <PluginChangelog id={id} />
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
