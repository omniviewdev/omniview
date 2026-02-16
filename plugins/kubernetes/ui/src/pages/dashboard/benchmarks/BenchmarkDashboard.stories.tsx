import type { Meta, StoryObj } from "@storybook/react";
import BenchmarkDashboard from "./BenchmarkDashboard";

import data from "./mock.json";

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "Kubernetes/Dashboard/Benchmark",
  component: BenchmarkDashboard,
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
} satisfies Meta<typeof BenchmarkDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    data,
    connectionID: 'minikube'
  },
};
//
// Primary.decorators = [
//   (Story, c) => (
//     <ResourceDrawerContainer
//       // @ts-expect-error - arbitrary json
//       title={c.args.data.metadata.name}
//       icon="LuServer"
//       type="core::v1::Node"
//       open
//       onClose={() => { }}
//     >
//       <Story />
//     </ResourceDrawerContainer>
//   ),
// ];
