import type { Meta, StoryObj } from "@storybook/react";
import { CronJobSidebar } from ".";
import data from "./mock.json";

import ResourceDrawerContainer from "../../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/CronJob",
  component: CronJobSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof CronJobSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    ctx: { data: data as any },
  },
};

Primary.decorators = [
  (Story, c) => (
    <ResourceDrawerContainer
      icon="LuFileCog"
      type="core::v1::CronJob"
      // @ts-expect-error - arbitrary json
      title={c.args.ctx.data.metadata.name}
      open
      onClose={() => {}}
    >
      <Story />
    </ResourceDrawerContainer>
  ),
];
