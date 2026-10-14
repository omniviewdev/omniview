import React from "react";
import { Chip } from "@omniviewdev/base-ui";
import SectionCard from "./ui/SectionCard";
import LabeledRow, { ValueText } from "./ui/LabeledRow";
import { chipStyle, toColor } from "./ui/colors";

type DetailEntry = {
  label: string;
  value: string | number | boolean | React.ReactNode | undefined | null;
  color?: "success" | "danger" | "warning" | "neutral" | "primary";
};

interface Props {
  title: string;
  icon?: React.ReactNode;
  entries: DetailEntry[];
}

const DetailRow: React.FC<{ entry: DetailEntry }> = ({ entry }) => {
  if (entry.value === undefined || entry.value === null || entry.value === "") return null;

  let rendered: React.ReactNode;
  if (typeof entry.value === "boolean") {
    rendered = (
      <Chip size="sm" color={entry.value ? "success" : "neutral"} variant="solid" style={chipStyle}>
        {entry.value ? "Yes" : "No"}
      </Chip>
    );
  } else if (entry.color) {
    rendered = (
      <Chip size="sm" color={toColor(entry.color)} variant="solid" style={chipStyle}>
        {String(entry.value)}
      </Chip>
    );
  } else if (React.isValidElement(entry.value)) {
    rendered = entry.value;
  } else {
    rendered = <ValueText>{String(entry.value)}</ValueText>;
  }

  return (
    <LabeledRow label={entry.label}>
      {rendered}
    </LabeledRow>
  );
};

const DetailsCard: React.FC<Props> = ({ title, icon, entries }) => {
  const visibleEntries = entries.filter(
    (e) => e.value !== undefined && e.value !== null && e.value !== ""
  );

  if (visibleEntries.length === 0) return null;

  return (
    <SectionCard title={title} icon={icon}>
      {visibleEntries.map((entry, i) => (
        <DetailRow key={i} entry={entry} />
      ))}
    </SectionCard>
  );
};

export type { DetailEntry };
export default DetailsCard;
