import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { RuntimeClass } from "kubernetes-types/node/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: RuntimeClass;
}

/**
 * Renders a sidebar for a RuntimeClass resource
 */
export const RuntimeClassSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return (<></>)
  }

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
