import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { VolumeAttachment } from "kubernetes-types/storage/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: VolumeAttachment;
}

/**
 * Renders a sidebar for a VolumeAttachment resource
 */
export const VolumeAttachmentSidebar: React.FC<Props> = ({ data }) => {
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

VolumeAttachmentSidebar.displayName = "VolumeAttachmentSidebar";
export default VolumeAttachmentSidebar;
