import React, { useState } from "react";
import { Chip, Stack, Text } from "@omniviewdev/base-ui";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import styles from "./KVCard.module.css";

interface Props {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
}

const KVCard: React.FC<Props> = ({ title, kvs, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const disabled = !Object.keys(kvs).length;

  return (
    <div className={styles.root}>
      <div
        className={styles.header}
        data-disabled={disabled || undefined}
        onClick={() => !disabled && setExpanded(!expanded)}
      >
        <span className={styles.chevron}>
          {expanded ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </span>
        <Stack direction="row" spacing={2} align="center">
          <Text weight="semibold" size="sm">{title}</Text>
          <Chip size="sm" variant="outline" color="brand" style={{ borderRadius: 4 }}>
            {Object.keys(kvs).length}
          </Chip>
        </Stack>
      </div>
      {expanded && (
        <div className={styles.body}>
          <div className={styles.grid}>
            {Object.entries(kvs).map(([key, value]) => (
              <React.Fragment key={key}>
                <Text size="xs" style={{ fontSize: 12, fontWeight: 400 }}>
                  {key}
                </Text>
                <Text size="xs" style={{ fontSize: 12, fontWeight: 600 }}>
                  {value}
                </Text>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default KVCard;
