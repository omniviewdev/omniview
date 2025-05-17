import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { LimitRange } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: LimitRange;
}

/**
 * Renders a sidebar for a LimitRange resource
 */
export const LimitRangeSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

LimitRangeSidebar.displayName = "LimitRangeSidebar";
export default LimitRangeSidebar;
