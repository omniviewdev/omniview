import type { Meta, StoryObj } from "@storybook/react";
import { ControllerRevisionSidebar } from ".";

import data from "./mock.json";
import ResourceDrawerContainer from "../../../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/ControllerRevision",
  component: ControllerRevisionSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof ControllerRevisionSidebar>;

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
      type="apps::v1::ControllerRevision"
      title={c.args.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
