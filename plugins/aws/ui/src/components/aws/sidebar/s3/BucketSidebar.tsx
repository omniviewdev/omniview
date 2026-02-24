import React from "react";
import { Stack } from "@omniviewdev/ui/layout";
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const BucketSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  return (
    <Stack direction="column" width="100%" spacing={1}>
      <MetadataSection data={data} />

      <DetailsCard
        title="Bucket Info"
        entries={[
          { label: "Name", value: data?.Name },
          { label: "ARN", value: data?.Name ? `arn:aws:s3:::${data.Name}` : undefined },
          { label: "Region", value: data?.Region },
          { label: "Creation Date", value: data?.CreationDate },
        ]}
      />

      <TagsSection data={data} />
    </Stack>
  );
};

export default BucketSidebar;
