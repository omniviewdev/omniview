import React from 'react';
import { Button, Text } from '@omniviewdev/base-ui';
import { useNavigate } from 'react-router';
import styles from './HomepageEmptyState.module.css';

const HomepageEmptyState: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.Root}>
      <div className={styles.Content}>
        <Text size='lg' weight='semibold'>
          No cards installed
        </Text>
        <Text tone='muted' className={styles.Description}>
          Install a plugin to see actionable content here.
        </Text>
        <Button variant='solid' color='brand' onClick={() => {
          void navigate('/plugins');
        }}>
          Browse Plugins
        </Button>
      </div>
    </div>
  );
};

export default HomepageEmptyState;
