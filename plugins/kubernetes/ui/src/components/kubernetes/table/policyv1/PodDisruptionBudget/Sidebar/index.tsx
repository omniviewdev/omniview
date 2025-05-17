import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { PodDisruptionBudget } from "kubernetes-types/policy/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: PodDisruptionBudget;
}

/**
 * Renders a sidebar for a PodDisruptionBudget resource
 */
export const PodDisruptionBudgetSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

PodDisruptionBudgetSidebar.displayName = "PodDisruptionBudgetSidebar";
export default PodDisruptionBudgetSidebar;
