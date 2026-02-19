import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Service } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<Service>;
}

/**
 * Renders a sidebar for a Service resource
 */
export const ServiceSidebar: React.FC<Props> = ({ ctx }) => {
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

ServiceSidebar.displayName = "ServiceSidebar";
export default ServiceSidebar;
