import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Job } from "kubernetes-types/batch/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: Job;
}

/**
 * Renders a sidebar for a ReplicaSet resource
 */
export const JobSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

JobSidebar.displayName = "JobSidebar";
export default JobSidebar;
