import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { LimitRange } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<LimitRange>;
}

/**
 * Renders a sidebar for a LimitRange resource
 */
export const LimitRangeSidebar: React.FC<Props> = ({ ctx }) => {
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

LimitRangeSidebar.displayName = "LimitRangeSidebar";
export default LimitRangeSidebar;
