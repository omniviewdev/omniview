import { examples } from '@omniviewdev/kit/examples';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
  title: 'Kit/Button',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function example(name: string): Story {
  const render = examples.Button?.[name];
  if (!render) throw new Error(`Missing kit Button example: ${name}`);
  return { render };
}

export const Primary = example('Primary');
export const PrimaryCompact = example('PrimaryCompact');
export const Secondary = example('Secondary');
export const SecondaryCompact = example('SecondaryCompact');
export const Ghost = example('Ghost');
export const GhostCompact = example('GhostCompact');
export const Danger = example('Danger');
export const DangerCompact = example('DangerCompact');
export const PrimaryDanger = example('PrimaryDanger');
export const GhostCompactDanger = example('GhostCompactDanger');
export const WithIcon = example('WithIcon');
export const ClearFilters = example('ClearFilters');
export const PrimaryWithIcon = example('PrimaryWithIcon');
export const LoadMore = example('LoadMore');
export const SecondaryDisabled = example('SecondaryDisabled');
export const PrimaryDisabled = example('PrimaryDisabled');
export const GhostCompactDisabled = example('GhostCompactDisabled');
export const DangerDisabled = example('DangerDisabled');
export const PrimaryDangerDisabled = example('PrimaryDangerDisabled');
export const WithIconDisabled = example('WithIconDisabled');
export const DisabledWithVisibleReason = example('DisabledWithVisibleReason');
export const Busy = example('Busy');
export const BusyWithoutIcon = example('BusyWithoutIcon');
export const Row = example('Row');
export const RowGhost = example('RowGhost');
