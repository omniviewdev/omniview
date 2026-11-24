import { EmptyState, Stack, Text } from '@omniviewdev/kit';
import { useState } from 'react';

/** Explain what will appear without offering a button when there is nothing to do. */
export const NoAction = () => <EmptyState icon="bell-off" title="No notifications" hint="Messages from plugins and operations you start appear here." />;

/** Use a bare glyph in a shallow surface. Press New terminal to see the owning view record the request. */
export const CompactWithAction = () => {
  const [requests, setRequests] = useState(0);
  return (
    <Stack gap={8}>
      <EmptyState
        compact
        icon="chevron-right"
        title="No terminals"
        hint="Start a shell in this window."
        action={{
          label: 'New terminal',
          icon: 'plus',
          onSelect: () => {
            setRequests((count) => count + 1);
          },
        }}
      />
      <Text as="p" variant="caption" tone="muted">
        <span role="status">{`Terminal launch requests: ${String(requests)}`}</span>
      </Text>
    </Stack>
  );
};
