import React from "react";

interface Props {
  data: object;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ data }) => {
  // compose your component here

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};

PersistentVolumeSidebar.displayName = "PersistentVolumeSidebar";
export default PersistentVolumeSidebar;
