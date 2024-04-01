import type { Meta, StoryObj } from "@storybook/react";
import { ReplicaSetSidebar } from ".";

import data from "./mock.json";
import ResourceDrawerContainer from "../../../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/ReplicaSet",
  component: ReplicaSetSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof ReplicaSetSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    data,
    onSubmit: () => {},
    onCancel: () => {},
    useSearch: () => [],
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      type="apps::v1::ReplicaSet"
      title={c.args.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
