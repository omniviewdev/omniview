import React from "react";

interface Props {
  data: object;
}

export const PersistentVolumeClaimSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

PersistentVolumeClaimSidebar.displayName = "PersistentVolumeClaimSidebar";
export default PersistentVolumeClaimSidebar;
