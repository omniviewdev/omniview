import type { Meta, StoryObj } from "@storybook/react";
import { IngressSidebar } from ".";
import data from "./mock.json";

import ResourceDrawerContainer from "../../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/Ingress",
  component: IngressSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof IngressSidebar>;

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
      icon="LuNetworking"
      type="networking::v1::Ingress"
      // @ts-expect-error - arbitrary json
      title={c.args.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
