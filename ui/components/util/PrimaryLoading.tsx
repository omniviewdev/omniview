import { Text } from '@omniviewdev/base-ui';
import styles from './PrimaryLoading.module.css';

type PrimaryLoadingProps = {
  message?: string;
};

/**
 * Primary loading page for the app
 */
const PrimaryLoading = ({ message }: PrimaryLoadingProps) => {
  return (
    <div className={styles.Root}>
      <div className={styles.IconFrame}>
        <img src="/appicon.png" alt="" className={styles.Icon} />
      </div>
      {message && (
        <Text size="sm" tone="subtle">{message}</Text>
      )}
    </div>
  );
};

export default PrimaryLoading;
