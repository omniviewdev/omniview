import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { RuntimeClass } from "kubernetes-types/node/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<RuntimeClass>;
}

/**
 * Renders a sidebar for a RuntimeClass resource
 */
export const RuntimeClassSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

RuntimeClassSidebar.displayName = "RuntimeClassSidebar";
export default RuntimeClassSidebar;
