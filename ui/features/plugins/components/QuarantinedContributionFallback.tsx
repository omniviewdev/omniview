import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

export interface QuarantinedContributionFallbackProps {
  readonly pluginId: string;
  readonly extensionPointId: string;
  readonly contributionId: string;
  readonly crashCount: number;
  readonly onReEnable: () => void;
}

/**
 * Dev-mode inline fallback for quarantined contributions.
 * Shows which contribution was suppressed and offers a re-enable button.
 * Only rendered in dev mode — production uses empty slots + notifications.
 */
export function QuarantinedContributionFallback({
  pluginId,
  extensionPointId,
  contributionId,
  crashCount,
  onReEnable,
}: QuarantinedContributionFallbackProps): React.ReactElement {
  return (
    <Box
      role="alert"
      sx={{
        p: 1.5,
        border: '1px dashed',
        borderColor: 'warning.main',
        borderRadius: 1,
        bgcolor: 'warning.light',
      }}
    >
      <Typography variant="caption" color="warning.main" fontWeight="bold">
        Quarantined Extension
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Plugin: {pluginId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Extension Point: {extensionPointId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Contribution: {contributionId}
      </Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Crashes: {crashCount}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        color="warning"
        onClick={onReEnable}
        sx={{ mt: 1 }}
      >
        Re-enable
      </Button>
    </Box>
  );
}
