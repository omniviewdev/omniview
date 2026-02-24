import type { Meta, StoryObj } from "@storybook/react";
import { PodSidebar } from ".";

import data from "./mock.json";
import ResourceDrawerContainer from "../../../../stories/containers/SidebarContainer";
import { Pod } from "kubernetes-types/core/v1";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/PodSidebar",
  component: PodSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof PodSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    ctx: {
      data: data as unknown as Pod,
    }
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      type="core::v1::Pod"
      icon="LuBox"
      // @ts-expect-error - arbitrary json
      title={c.args.ctx.data?.metadata?.name}
      open
      onClose={() => { }}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
