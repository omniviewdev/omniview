import React from 'react';
import { Button, Dialog, Separator, Spinner, Stack, Text } from '@omniviewdev/base-ui';
import TextInput from '../shared/ui/TextInput';

type Props = {
  open: boolean;
  onClose: () => void;
  verificationURL: string;
  userCode: string;
  expiresAt: string;
  onRetry: () => void;
  isRetrying: boolean;
};

const SSOLoginDialog: React.FC<Props> = ({
  open,
  onClose,
  verificationURL,
  userCode,
  expiresAt,
  onRetry,
  isRetrying,
}) => {
  const [timeLeft, setTimeLeft] = React.useState('');
  const openedRef = React.useRef(false);

  // Open browser on first mount with a valid URL
  React.useEffect(() => {
    if (open && verificationURL && !openedRef.current) {
      openedRef.current = true;
      window.open(verificationURL, '_blank');
    }
    if (!open) {
      openedRef.current = false;
    }
  }, [open, verificationURL]);

  // Countdown timer
  React.useEffect(() => {
    if (!open || !expiresAt) return;

    const update = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      if (remaining <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [open, expiresAt]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(userCode);
  };

  const handleReopenBrowser = () => {
    window.open(verificationURL, '_blank');
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm">
      <div style={{ maxWidth: 420, padding: 24 }}>
        <Text weight="semibold" size="lg" as="div" style={{ marginBottom: 4 }}>
          AWS SSO Login
        </Text>
        <Text size="sm" tone="muted" as="div" style={{ marginBottom: 16 }}>
          Complete the sign-in in your browser, then click the button below.
        </Text>

        <Stack spacing={4}>
          <div>
            <Text size="xs" as="div" style={{ marginBottom: 4, fontWeight: 600 }}>
              Verification Code
            </Text>
            <Stack direction="row" spacing={1} align="center">
              <TextInput
                value={userCode}
                size="sm"
                readOnly
                mono
                inputProps={{ style: { fontWeight: 700, letterSpacing: 2 } }}
                style={{ flex: 1 }}
              />
              <Button
                variant="soft"
                size="sm"
                onClick={handleCopyCode}
              >
                Copy
              </Button>
            </Stack>
          </div>

          <Text as="div" size="xs" tone="muted" style={{ textAlign: 'center' }}>
            {timeLeft === 'Expired' ? 'Code expired -- close and try again' : `Expires in ${timeLeft}`}
          </Text>

          <Separator />

          <Stack direction="row" spacing={2}>
            <Button
              variant="outline"
              color="neutral"
              size="sm"
              onClick={handleReopenBrowser}
              disabled={timeLeft === 'Expired'}
              style={{ flex: 1 }}
            >
              Reopen Browser
            </Button>
            <Button
              variant="solid"
              color="brand"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying || timeLeft === 'Expired'}
              startDecorator={isRetrying ? <Spinner size="sm" /> : undefined}
              style={{ flex: 1 }}
            >
              {isRetrying ? 'Checking...' : "I've Logged In"}
            </Button>
          </Stack>

          <Button
            variant="ghost"
            color="neutral"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        </Stack>
      </div>
    </Dialog>
  );
};

export default SSOLoginDialog;
