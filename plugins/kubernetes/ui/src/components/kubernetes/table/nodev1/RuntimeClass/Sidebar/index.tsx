import React from "react";

import { Stack } from "@omniviewdev/ui/layout";

import { RuntimeClass } from "kubernetes-types/node/v1";
import { DrawerContext } from "@omniviewdev/runtime";

import MetadataSection from "../../../../../shared/sidebar/pages/overview/sections/MetadataSection";
import RuntimeClassHandlerSection from "./RuntimeClassHandlerSection";
import RuntimeClassSchedulingSection from "./RuntimeClassSchedulingSection";

interface Props {
  ctx: DrawerContext<RuntimeClass>;
}

export const RuntimeClassSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  return (
    <Stack direction="column" width="100%" spacing={2}>
      <Stack direction="column" spacing={0.5}>
        <MetadataSection data={data.metadata} />
        <RuntimeClassHandlerSection data={data} />
      </Stack>
      {data.scheduling && (
        <RuntimeClassSchedulingSection scheduling={data.scheduling} />
      )}
    </Stack>
  );
};

RuntimeClassSidebar.displayName = "RuntimeClassSidebar";
export default RuntimeClassSidebar;
