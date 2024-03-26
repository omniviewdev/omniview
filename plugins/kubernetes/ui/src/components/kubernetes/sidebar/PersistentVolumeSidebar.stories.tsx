import type { Meta, StoryObj } from "@storybook/react";
import { PersistentVolumeSidebar } from "./PersistentVolumeSidebar";

import data from "./pv.mock.json";
import ResourceDrawerContainer from "../../../stories/containers/SidebarContainer";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Sidebars/PersistentVolumeSidebar",
  component: PersistentVolumeSidebar,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof PersistentVolumeSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    data,
  },
};

Primary.decorators = [
  (Story) => (
    <ResourceDrawerContainer title="PersistentVolume" open onClose={() => {}}>
      <Story />
    </ResourceDrawerContainer>
  ),
];
