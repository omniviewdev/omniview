import { FileButton, Stack, Text } from '@omniviewdev/kit';
import { useState } from 'react';

// A button written the way a consumer writes it: it reports the files, and what to do with them (read, decode, limit) is the caller's.

/** The default: a button that opens the picker. */
export const Default = () => {
  const [name, setName] = useState('No file chosen');
  return (
    <Stack direction="row" gap={8} align="center">
      <FileButton
        accept={['image/png', 'image/jpeg', 'image/webp']}
        onFiles={(files) => {
          setName(files[0]?.name ?? 'No file chosen');
        }}
      >
        Import image…
      </FileButton>
      <Text tone="muted">{name}</Text>
    </Stack>
  );
};

/** With a glyph before the label, and more than one file allowed. */
export const WithIcon = () => (
  <FileButton icon="folder-tree" multiple onFiles={() => undefined}>
    Choose files…
  </FileButton>
);

/** The caller is working on the files: busy at once, the loader after a second, and no picker meanwhile. */
export const Busy = () => (
  <FileButton icon="folder-tree" busy onFiles={() => undefined}>
    Import image…
  </FileButton>
);

/** Unavailable for a reason: it stays focusable, opens no picker, and says why. */
export const DisabledWithReason = () => (
  <FileButton disabledReason="Save the item before adding an image." onFiles={() => undefined}>
    Import image…
  </FileButton>
);
