import React from "react";
import DetailsCard from "../../../shared/DetailsCard";
import type { DetailEntry } from "../../../shared/DetailsCard";

interface Props {
  data: Record<string, any>;
}

/**
 * Displays EC2 placement information including availability zone,
 * placement group, tenancy, and host ID.
 */
const PlacementSection: React.FC<Props> = ({ data }) => {
  const placement = data.Placement || {};

  const entries: DetailEntry[] = [
    { label: "Availability Zone", value: placement.AvailabilityZone },
    { label: "Placement Group", value: placement.GroupName || placement.GroupId },
    { label: "Tenancy", value: placement.Tenancy },
    { label: "Host ID", value: placement.HostId },
  ];

  return <DetailsCard title="Placement" entries={entries} />;
};

export default PlacementSection;
