import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { EndpointSlice } from "kubernetes-types/discovery/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<EndpointSlice>;
}

/**
 * Renders a sidebar for a EndpointSlice resource
 */
export const EndpointSliceSidebar: React.FC<Props> = ({ ctx }) => {
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

EndpointSliceSidebar.displayName = "EndpointSliceSidebar";
export default EndpointSliceSidebar;
