import React from 'react';

// Material-ui
import { Stack } from '@omniviewdev/ui/layout';

// Mock data
import mock from '../mock/kubernetes/changelog.json';
import PluginChangelogCard from './PluginChangelogCard';

type Props = {
  id: string;
};

export type Changelog = {
  version: string;
  releaseDate: string;
  changes: Changes;
};

export type Changes = {
  feature: string[];
  bugfix: string[];
  security: string[];
};

const PluginChangelog: React.FC<Props> = ({ }) => (
  <Stack direction='column' p={6} gap={3} maxHeight={'100%'} overflow={'scroll'}>
    {mock.map((record: Changelog) => (
      <PluginChangelogCard {...record} />
    ))}
  </Stack>
);

export default PluginChangelog;
