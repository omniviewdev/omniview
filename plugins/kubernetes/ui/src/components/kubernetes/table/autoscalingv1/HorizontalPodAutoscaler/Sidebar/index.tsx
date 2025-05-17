import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { HorizontalPodAutoscaler } from "kubernetes-types/autoscaling/v2";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: HorizontalPodAutoscaler;
}

/**
 * Renders a sidebar for a HorizontalPodAutoscaler resource
 */
export const HorizontalPodAutoscalerSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

HorizontalPodAutoscalerSidebar.displayName = "HorizontalPodAutoscalerSidebar";
export default HorizontalPodAutoscalerSidebar;
