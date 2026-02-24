import React from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Modal } from '@omniviewdev/ui/overlays';

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
    <Modal open={open} onClose={onClose}>
      <Box sx={{ maxWidth: 420, p: 3 }}>
        <Text weight="semibold" size="lg" sx={{ mb: 0.5 }}>
          AWS SSO Login
        </Text>
        <Text size="sm" sx={{ mb: 2, color: 'text.secondary' }}>
          Complete the sign-in in your browser, then click the button below.
        </Text>

        <Stack spacing={2}>
          <Box>
            <Text size="xs" sx={{ mb: 0.5, fontWeight: 600 }}>
              Verification Code
            </Text>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <TextField
                value={userCode}
                onChange={() => {}}
                size="sm"
                readOnly
                monospace
                sx={{ fontWeight: 700, letterSpacing: 2, flex: 1 }}
              />
              <Button
                emphasis="soft"
                size="sm"
                onClick={handleCopyCode}
              >
                Copy
              </Button>
            </Stack>
          </Box>

          <Text size="xs" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {timeLeft === 'Expired' ? 'Code expired -- close and try again' : `Expires in ${timeLeft}`}
          </Text>

          <Divider />

          <Stack direction="row" spacing={1}>
            <Button
              emphasis="outline"
              color="neutral"
              size="sm"
              onClick={handleReopenBrowser}
              disabled={timeLeft === 'Expired'}
              sx={{ flex: 1 }}
            >
              Reopen Browser
            </Button>
            <Button
              emphasis="solid"
              color="primary"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying || timeLeft === 'Expired'}
              startAdornment={isRetrying ? <CircularProgress size={16} /> : undefined}
              sx={{ flex: 1 }}
            >
              {isRetrying ? 'Checking...' : "I've Logged In"}
            </Button>
          </Stack>

          <Button
            emphasis="ghost"
            color="neutral"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        </Stack>
      </Box>
    </Modal>
  );
};

export default SSOLoginDialog;
