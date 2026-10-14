import { Button, Heading, Text } from '@omniviewdev/base-ui';
import { LuArrowLeft, LuFileQuestion } from 'react-icons/lu';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './PluginNotFoundPage.module.css';

/**
 * Rendered when no route matches within a plugin. Shows a clean "page not found"
 * message with the unmatched path and a back button.
 */
export default function PluginNotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className={styles.Root}>
      <LuFileQuestion size={56} className={styles.Icon} />

      <Heading level={4} as='h5' className={styles.Title}>
        Page not found
      </Heading>

      <Text as='p' size='md' tone='muted' className={styles.Subtitle}>
        The route you navigated to doesn't exist within this plugin.
      </Text>

      {/* Path detail */}
      <div className={styles.PathBox}>
        <p className={styles.PathText}>{location.pathname}</p>
      </div>

      {/* Actions */}
      <div className={styles.Actions}>
        <Button
          variant='solid'
          color='brand'
          size='sm'
          onClick={() => {
            navigate(-1); 
          }}
          startDecorator={<LuArrowLeft size={14} />}
        >
          Go Back
        </Button>
      </div>
    </div>
  );
}
