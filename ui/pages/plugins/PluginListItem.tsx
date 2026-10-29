import React from 'react';

import { Avatar, Spinner } from '@omniviewdev/base-ui';

import { LuAtom, LuBadgeCheck, LuCheck, LuDownload, LuStar, LuSettings } from 'react-icons/lu';
import { Link } from 'react-router';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';
import styles from './PluginListItem.module.css';
import { orFallback } from '@/utils/orFallback';

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

function PhaseDot({ phase }: { phase: PhaseStatus }) {
  return (
    <span
      className={styles.PhaseDot}
      data-transient={TRANSIENT_PHASES.has(phase) ? 'true' : undefined}
      style={{ backgroundColor: PHASE_COLORS[phase] || '#8b949e' }}
    />
  );
}

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
  official?: boolean;
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
  official,
  downloadCount,
  averageRating,
  onInstall,
  installing,
}) => {
  const displayAuthor = orFallback(author, publisherName) ?? '';
  const showPhase = installed && phase;
  let imageSrc: string | undefined;

  if (iconUrl) {
    imageSrc = iconUrl;
  } else if (icon && IsImage(icon)) {
    imageSrc = icon;
  }

  return (
    <Link to={`/plugins/${id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className={styles.Item} data-active={active ? 'true' : undefined}>
        {/* Icon */}
        <div className={styles.IconBox}>
          {imageSrc ? (
            <Avatar
              size='xs'
              shape='rounded'
              src={imageSrc}
              alt={name}
              className={styles.IconImage}
            />
          ) : icon ? (
            <Icon name={icon} size={36} />
          ) : (
            <div className={styles.IconFallback}>
              {name?.[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Content */}
        <div className={styles.Content}>
          {/* Row 1: Name + Action */}
          <div className={styles.TitleRow}>
            <div className={styles.NameGroup}>
              <span className={styles.Name}>
                {name}
              </span>
              {official && (
                <LuBadgeCheck size={13} color='var(--ov-color-brand-500)' style={{ flexShrink: 0 }} />
              )}
            </div>

            {/* Action area */}
            <div className={styles.ActionArea}>
              {installed ? (
                <>
                  {devMode && (
                    <LuAtom size={11} color='var(--ov-color-warning)' />
                  )}
                  {version && (
                    <span className={styles.Version}>
                      {version}
                    </span>
                  )}
                  <span className={styles.Gear}>
                    <LuSettings size={12} color='var(--ov-color-fg-subtle)' />
                  </span>
                </>
              ) : installing ? (
                <Spinner size='xs' color='brand' />
              ) : onInstall ? (
                installed ? (
                  <LuCheck size={14} color='var(--ov-color-success)' />
                ) : (
                  <button
                    type='button'
                    className={styles.InstallButton}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onInstall();
                    }}
                  >
                    Install
                  </button>
                )
              ) : null}
            </div>
          </div>

          {/* Row 2: Description */}
          <div className={styles.Description}>
            {orFallback(description, '\u00A0')}
          </div>

          {/* Row 3: Author + Stats */}
          <div className={styles.Meta}>
            {showPhase && <PhaseDot phase={phase} />}
            {displayAuthor && (
              <span className={styles.Author}>
                {displayAuthor}
              </span>
            )}
            {typeof downloadCount === 'number' && downloadCount > 0 && (
              <span className={styles.Stat}>
                <LuDownload size={9} />
                <span>{formatDownloads(downloadCount)}</span>
              </span>
            )}
            {typeof averageRating === 'number' && (
              <span className={styles.Stat}>
                <LuStar size={9} style={{ color: averageRating > 0 ? '#e3b341' : undefined }} />
                <span>{averageRating > 0 ? averageRating.toFixed(1) : '0'}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
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

export default PluginListItem;
