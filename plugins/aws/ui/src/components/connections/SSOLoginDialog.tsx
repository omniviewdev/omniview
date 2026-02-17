import React from 'react';
import Modal from '@mui/joy/Modal';
import ModalDialog from '@mui/joy/ModalDialog';
import Typography from '@mui/joy/Typography';
import Button from '@mui/joy/Button';
import Stack from '@mui/joy/Stack';
import Input from '@mui/joy/Input';
import Divider from '@mui/joy/Divider';
import Box from '@mui/joy/Box';
import CircularProgress from '@mui/joy/CircularProgress';

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
      <ModalDialog
        variant="outlined"
        sx={{ maxWidth: 420, p: 3 }}
      >
        <Typography level="h4" sx={{ mb: 0.5 }}>
          AWS SSO Login
        </Typography>
        <Typography level="body-sm" sx={{ mb: 2, color: 'text.secondary' }}>
          Complete the sign-in in your browser, then click the button below.
        </Typography>

        <Stack spacing={2}>
          <Box>
            <Typography level="body-xs" sx={{ mb: 0.5, fontWeight: 600 }}>
              Verification Code
            </Typography>
            <Input
              value={userCode}
              readOnly
              endDecorator={
                <Button
                  variant="soft"
                  size="sm"
                  onClick={handleCopyCode}
                >
                  Copy
                </Button>
              }
              sx={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2 }}
            />
          </Box>

          <Typography level="body-xs" sx={{ color: 'text.tertiary', textAlign: 'center' }}>
            {timeLeft === 'Expired' ? 'Code expired — close and try again' : `Expires in ${timeLeft}`}
          </Typography>

          <Divider />

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="neutral"
              size="sm"
              onClick={handleReopenBrowser}
              disabled={timeLeft === 'Expired'}
              sx={{ flex: 1 }}
            >
              Reopen Browser
            </Button>
            <Button
              variant="solid"
              color="primary"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying || timeLeft === 'Expired'}
              startDecorator={isRetrying ? <CircularProgress size="sm" /> : undefined}
              sx={{ flex: 1 }}
            >
              {isRetrying ? 'Checking...' : "I've Logged In"}
            </Button>
          </Stack>

          <Button
            variant="plain"
            color="neutral"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
};

export default SSOLoginDialog;
