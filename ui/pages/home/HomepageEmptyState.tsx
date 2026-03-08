import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import { useNavigate } from 'react-router-dom';

const HomepageEmptyState: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
      }}
    >
      <Stack direction="column" alignItems="center" gap={2}>
        <Text size="lg" weight="semibold">
          No cards installed
        </Text>
        <Text sx={{ color: 'text.secondary', textAlign: 'center' }}>
          Install a plugin to see actionable content here.
        </Text>
        <Button variant="contained" onClick={() => navigate('/plugins')}>
          Browse Plugins
        </Button>
      </Stack>
    </Box>
  );
};

export default HomepageEmptyState;
