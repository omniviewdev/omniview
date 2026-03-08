import type React from 'react';

/**
 * Types for the omniview/home/card extension point.
 * Plugins that contribute homepage cards import these types.
 */

export type HomepageCardSection = 'recent' | 'favorites' | 'folders' | (string & {});

export type HomepageCardConfig = {
  sections: HomepageCardSection[];
  maxItems?: number; // per section, default 5
};

export type HomepageCardProps = {
  pluginID: string;
  config: HomepageCardConfig;
};

export type HomepageCardMeta = {
  label: string;
  description?: string;
  defaultConfig: HomepageCardConfig;
  defaultWidth?: 'small' | 'medium' | 'large';
  /** Optional icon component rendered in the card header instead of the text label. */
  icon?: React.ComponentType<{ size?: number; color?: string }>;
};
