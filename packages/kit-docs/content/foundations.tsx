import { Stack, Text } from '@omniviewdev/kit';

export const StackDefault = () => (
  <Stack gap={8} pad={12}>
    <Text variant="title">Deployment</Text>
    <Stack direction="row" gap={6} align="baseline">
      <Text>Namespace</Text>
      <Text tone="muted">production</Text>
    </Stack>
  </Stack>
);

export const TextDefault = () => (
  <section>
    <Text as="h2" variant="heading">Deployment history</Text>
    <Text as="p">The latest deployment is ready.</Text>
    <Text as="p" variant="caption" tone="muted">Updated 5 minutes ago</Text>
  </section>
);
