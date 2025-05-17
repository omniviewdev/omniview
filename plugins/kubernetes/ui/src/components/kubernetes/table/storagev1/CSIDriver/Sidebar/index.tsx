import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { CSIDriver } from "kubernetes-types/storage/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: CSIDriver;
}

/**
 * Renders a sidebar for a CSIDriver resource
 */
export const CSIDriverSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <></>
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

CSIDriverSidebar.displayName = "CSIDriverSidebar";
export default CSIDriverSidebar;
