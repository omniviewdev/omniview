import * as React from 'react';

import { Chip, Stack, Text, useTheme } from '@omniviewdev/base-ui';

// Third party
import MarkdownPreview from '@uiw/react-markdown-preview';

import markdownStyles from '../PluginMarkdown.module.css';
import styles from './PluginChangelog.module.css';

type Props = {
  version: string;
  releaseDate: string;
  changelog: string;
};

const PluginChangelogCard: React.FC<Props> = ({ version, releaseDate, changelog }) => {
  const { activeTheme } = useTheme();

  return (
    <div className={styles.Card}>
      <Stack direction='row' spacing={3} align='center' className={styles.CardHeader}>
        <Chip
          size='sm'
          color='brand'
          variant='soft'
          mono
          className={styles.VersionChip}
        >
          {version}
        </Chip>
        {releaseDate && (
          <Text size='xs' tone='muted'>{releaseDate}</Text>
        )}
      </Stack>
      {changelog ? (
        <div data-color-mode={activeTheme.appearance} className={markdownStyles.Markdown}>
          <MarkdownPreview
            source={changelog}
            style={{ backgroundColor: 'transparent' }}
          />
        </div>
      ) : (
        <Text size='sm' tone='muted' className={styles.Empty}>
          No changelog provided
        </Text>
      )}
    </div>
  );
};

export default PluginChangelogCard;
