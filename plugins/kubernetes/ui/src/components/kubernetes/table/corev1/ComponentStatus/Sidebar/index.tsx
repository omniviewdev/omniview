import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { ComponentStatus } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<ComponentStatus>;
}

/**
 * Renders a sidebar for a ComponentStatus resource
 */
export const ComponentStatusSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ComponentStatusSidebar.displayName = "ComponentStatusSidebar";
export default ComponentStatusSidebar;
