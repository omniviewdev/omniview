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
  recovery?: { label: string; run: () => Promise<void> };
};

export default function TerminalError({ error, onRetry, backgroundColor, recovery }: Props) {
  const [showRaw, setShowRaw] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  const [recoveryError, setRecoveryError] = React.useState<string | null>(null);
  const recoveryPending = React.useRef(false);
  const recover = async () => {
    if (!recovery || recoveryPending.current) {
      return;
    }

    recoveryPending.current = true;
    setRecovering(true);
    setRecoveryError(null);
    try {
      await recovery.run();
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : 'Recovery failed. Review the resource and try again.');
    } finally {
      recoveryPending.current = false;
      setRecovering(false);
    }
  };

  return (
    <div role='alert' className={styles.Root} style={{ backgroundColor: backgroundColor ?? 'black' }}>
      <LuTriangleAlert size={32} className={styles.Icon} />

      <Text weight='semibold' className={styles.Title}>
        {error.title}
      </Text>

      <Text size='sm' tone='muted' className={styles.Suggestion}>
        {error.suggestion}
      </Text>

      {recovery && (
        <Button size='sm' disabled={recovering} aria-busy={recovering} onClick={() => {
          void recover(); 
        }}>
          {recovery.label}
        </Button>
      )}
      {recoveryError && <Text role='status' size='sm'>{recoveryError}</Text>}

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
