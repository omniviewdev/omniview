import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { HorizontalPodAutoscaler } from "kubernetes-types/autoscaling/v2";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<HorizontalPodAutoscaler>;
}

/**
 * Renders a sidebar for a HorizontalPodAutoscaler resource
 */
export const HorizontalPodAutoscalerSidebar: React.FC<Props> = ({ ctx }) => {
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

HorizontalPodAutoscalerSidebar.displayName = "HorizontalPodAutoscalerSidebar";
export default HorizontalPodAutoscalerSidebar;
