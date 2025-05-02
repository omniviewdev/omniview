import type { Meta, StoryObj } from "@storybook/react";
import ContainerStatusCell from "./ContainerStatusCell";

import data from "./mock.json";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Table Cells/ContainerStatusCell",
  component: ContainerStatusCell,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof ContainerStatusCell>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    data: data?.status?.containerStatuses,
  },
};

Primary.decorators = [
  (Story) => (
    <div style={{
      padding: '2px 8px',
      display: 'flex',
      alignItems: 'center',
      height: 35,
      width: 600,
      border: '1px solid darkgrey',
    }}>
      <Story />
    </div>
  ),
];
