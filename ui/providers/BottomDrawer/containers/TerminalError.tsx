import React from 'react';
import { LuTriangleAlert, LuChevronDown, LuChevronUp } from 'react-icons/lu';
import { Button, Text } from '@omniviewdev/base-ui';
import styles from './TerminalError.module.css';

export type TerminalErrorInfo = {
  title: string;
  suggestion: string;
  raw: string;
  retryable?: boolean;
  retryCommands?: string[];
};

type Props = {
  error: TerminalErrorInfo;
  onRetry: (command: string[]) => void;
  backgroundColor?: string;
};

export default function TerminalError({ error, onRetry, backgroundColor }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);

  return (
    <div className={styles.Root} style={{ backgroundColor: backgroundColor ?? 'black' }}>
      <LuTriangleAlert size={32} className={styles.Icon} />

      <Text weight='semibold' className={styles.Title}>
        {error.title}
      </Text>

      <Text size='sm' tone='muted' className={styles.Suggestion}>
        {error.suggestion}
      </Text>

      {/* Collapsible raw error */}
      <div className={styles.Details}>
        <button type='button' className={styles.DetailsToggle} onClick={() => {
          setShowRaw(!showRaw); 
        }} aria-expanded={showRaw}>
          <Text size='xs'>{showRaw ? 'Hide' : 'Show'} details</Text>
          {showRaw ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
        </button>
        {showRaw && <pre className={styles.Raw}>{error.raw}</pre>}
      </div>

      {/* Retry buttons — only shown when error is retryable with commands */}
      {error.retryable !== false && error.retryCommands && error.retryCommands.length > 0 && (
        <div className={styles.Retry}>
          <Text size='sm' tone='muted'>Try a different shell:</Text>
          <div className={styles.RetryButtons}>
            {error.retryCommands.map((cmd) => (
              <Button
                key={cmd}
                variant='outline'
                size='sm'
                className={styles.RetryButton}
                onClick={() => {
                  onRetry([cmd]); 
                }}
              >
                {cmd}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
