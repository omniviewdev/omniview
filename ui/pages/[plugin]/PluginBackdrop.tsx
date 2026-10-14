import * as React from 'react';
import { Dialog, Spinner, Text } from '@omniviewdev/base-ui';
import styles from './PluginBackdrop.module.css';

// The backdrop is not dismissable by the user.
const noop = (): void => undefined;

type Props = {
  ref?: React.RefObject<HTMLDivElement>;
  open: boolean;
  message: string;
};

export default function PluginBackdrop({ ref, open, message }: Props): React.ReactElement {
  console.log('PluginBackdrop', open, message);

  return (
    <Dialog
      ref={ref}
      open={open}
      onClose={noop}
      size='sm'
      aria-label={message}
    >
      <div className={styles.Content}>
        <Spinner size='xl' color='brand' />
        <Text size='sm'>{message}</Text>
      </div>
    </Dialog>
  );
}
