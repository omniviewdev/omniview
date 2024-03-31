import type { Meta, StoryObj } from "@storybook/react";
import { EndpointSidebar } from ".";
import data from "./mock.json";

import ResourceDrawerContainer from "../../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/Endpoint",
  component: EndpointSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof EndpointSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    data,
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      icon="LuFileCog"
      type="core::v1::Endpoints"
      // @ts-expect-error - arbitrary json
      title={c.args.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
