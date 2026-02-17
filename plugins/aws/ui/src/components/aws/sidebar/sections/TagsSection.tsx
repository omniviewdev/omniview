import React from "react";
import KVCard from "../../../shared/KVCard";

interface Props {
  data: Record<string, any>;
}

/**
 * Renders resource tags as a key-value accordion card.
 * Supports both AWS tag formats:
 *  - Array of {Key, Value} objects (most AWS APIs)
 *  - Flat Record<string, string> map
 */
const TagsSection: React.FC<Props> = ({ data }) => {
  const raw = data?.Tags;

  let kvs: Record<string, string> = {};

  if (Array.isArray(raw)) {
    for (const tag of raw) {
      if (tag?.Key) {
        kvs[tag.Key] = tag.Value ?? "";
      }
    }
  } else if (raw && typeof raw === "object") {
    kvs = Object.entries(raw).reduce<Record<string, string>>(
      (acc, [k, v]) => {
        acc[k] = String(v ?? "");
        return acc;
      },
      {}
    );
  }

  if (Object.keys(kvs).length === 0) return null;

  return <KVCard title="Tags" kvs={kvs} defaultExpanded />;
};

export default TagsSection;
