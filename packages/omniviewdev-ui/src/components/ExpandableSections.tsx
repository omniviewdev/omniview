import React, { useState, useCallback } from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { LuChevronRight, LuChevronDown } from "react-icons/lu";

import Icon from "./Icon";
import Chip from "./Chip";
import Text from "../typography/Text";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpandableSection {
  /** Unique key for the section (falls back to index) */
  key?: string;
  /** Icon: string name resolved via Icon component, or ReactNode */
  icon?: string | React.ReactNode;
  /** Title text or ReactNode */
  title: string | React.ReactNode;
  /** Optional count displayed as a small badge after the title */
  count?: number;
  /** Trailing content in the header row (status chips, action buttons, etc.) */
  endDecorator?: React.ReactNode;
  /** Expandable body content */
  children: React.ReactNode;
  /** Whether section starts expanded */
  defaultExpanded?: boolean;
  /** Controlled expanded state (overrides defaultExpanded) */
  expanded?: boolean;
  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
  /** Disable this section */
  disabled?: boolean;
}

export interface ExpandableSectionsProps {
  sections: ExpandableSection[];
  /** Visual variant */
  variant?: "bordered" | "plain" | "flush";
  /** Size/density */
  size?: "sm" | "md" | "lg";
  /** Use monospace font for titles */
  monospace?: boolean;
  /** Allow only one section open at a time */
  exclusive?: boolean;
  /** sx overrides on the root container */
  sx?: SxProps<Theme>;
}

// ---------------------------------------------------------------------------
// Size config
// ---------------------------------------------------------------------------

const sizeConfig = {
  sm: { minHeight: 28, headerPy: "4px", headerPx: 1, fontSize: 12, iconSize: 14, chevronSize: 14 },
  md: { minHeight: 32, headerPy: "6px", headerPx: 1.25, fontSize: 13, iconSize: 16, chevronSize: 16 },
  lg: { minHeight: 38, headerPy: "10px", headerPx: 1.5, fontSize: 14, iconSize: 18, chevronSize: 18 },
} as const;

// ---------------------------------------------------------------------------
// Variant styles
// ---------------------------------------------------------------------------

function rootSx(variant: "bordered" | "plain" | "flush"): SxProps<Theme> {
  switch (variant) {
    case "bordered":
      return {
        borderRadius: "6px",
        border: "1px solid var(--ov-border-default)",
      };
    case "plain":
      return {};
    case "flush":
      return {};
  }
}

function shouldShowDivider(variant: "bordered" | "plain" | "flush", index: number): boolean {
  if (index === 0) return false;
  return variant !== "flush";
}

// ---------------------------------------------------------------------------
// SingleSection — renders one Accordion
// ---------------------------------------------------------------------------

interface SingleSectionInternalProps {
  section: ExpandableSection;
  size: "sm" | "md" | "lg";
  monospace: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

function SingleSectionInternal({
  section,
  size,
  monospace,
  expanded: controlledExpanded,
  onExpandedChange,
}: SingleSectionInternalProps) {
  const cfg = sizeConfig[size];

  // Determine if this section is controlled
  const isControlled = controlledExpanded !== undefined || section.expanded !== undefined;
  const resolvedExpanded = controlledExpanded ?? section.expanded;

  const handleChange = (_: React.SyntheticEvent, exp: boolean) => {
    onExpandedChange?.(exp);
    section.onExpandedChange?.(exp);
  };

  // Build accordion props
  const accordionProps: Record<string, unknown> = {
    disableGutters: true,
    disabled: section.disabled,
    onChange: handleChange,
    sx: {
      boxShadow: "none",
      background: "transparent !important",
      "&:before": { display: "none" },
      "&.Mui-expanded": { margin: 0 },
    },
  };

  if (isControlled) {
    accordionProps.expanded = resolvedExpanded;
  } else {
    accordionProps.defaultExpanded = section.defaultExpanded;
  }

  // Render icon
  const renderIcon = () => {
    if (!section.icon) return null;
    if (typeof section.icon === "string") {
      return (
        <Box sx={{ display: "flex", alignItems: "center", mr: 0.75, color: "var(--ov-fg-muted)" }}>
          <Icon name={section.icon} size={cfg.iconSize} />
        </Box>
      );
    }
    return (
      <Box sx={{ display: "flex", alignItems: "center", mr: 0.75, color: "var(--ov-fg-muted)" }}>
        {section.icon}
      </Box>
    );
  };

  return (
    <Accordion {...accordionProps}>
      <AccordionSummary
        expandIcon={null}
        sx={{
          minHeight: cfg.minHeight,
          py: cfg.headerPy,
          px: cfg.headerPx,
          "&:hover": { bgcolor: "var(--ov-state-hover)" },
          "&.Mui-expanded": { minHeight: cfg.minHeight },
          "& .MuiAccordionSummary-content": {
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 0,
            "&.Mui-expanded": { margin: 0 },
          },
        }}
      >
        {/* Chevron */}
        <ChevronIcon size={cfg.chevronSize} />

        {/* Icon */}
        {renderIcon()}

        {/* Title */}
        <Text
          size={size === "lg" ? "md" : size}
          weight="semibold"
          inline
          sx={{
            color: "var(--ov-fg-base)",
            ...(monospace && { fontFamily: "var(--ov-font-mono)", fontSize: cfg.fontSize }),
            ...(!monospace && { fontSize: cfg.fontSize }),
            lineHeight: 1,
          }}
        >
          {section.title}
        </Text>

        {/* Count badge */}
        {section.count !== undefined && (
          <Box sx={{ ml: 0.75 }}>
            <Chip
              size="xs"
              color="neutral"
              emphasis="soft"
              label={section.count}
            />
          </Box>
        )}

        {/* Spacer */}
        <Box sx={{ flex: 1 }} />

        {/* End decorator */}
        {section.endDecorator && (
          <Box
            sx={{ display: "flex", alignItems: "center", ml: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            {section.endDecorator}
          </Box>
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>{section.children}</AccordionDetails>
    </Accordion>
  );
}

// ---------------------------------------------------------------------------
// Chevron — CSS-toggled based on MUI Mui-expanded class
// ---------------------------------------------------------------------------

function ChevronIcon({ size }: { size: number }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        mr: 0.75,
        color: "var(--ov-fg-muted)",
      }}
    >
      <Box
        component="span"
        sx={{
          display: "flex",
          ".MuiAccordionSummary-root.Mui-expanded &": { display: "none" },
        }}
      >
        <LuChevronRight size={size} />
      </Box>
      <Box
        component="span"
        sx={{
          display: "none",
          ".MuiAccordionSummary-root.Mui-expanded &": { display: "flex" },
        }}
      >
        <LuChevronDown size={size} />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function SectionDivider() {
  return <Box sx={{ height: "1px", bgcolor: "var(--ov-border-default)" }} />;
}

// ---------------------------------------------------------------------------
// ExpandableSections (plural) — renders multiple sections in a container
// ---------------------------------------------------------------------------

export default function ExpandableSections({
  sections,
  variant = "bordered",
  size = "md",
  monospace = false,
  exclusive = false,
  sx,
}: ExpandableSectionsProps): React.ReactElement {
  // Track expanded state for exclusive mode
  const [expandedIndex, setExpandedIndex] = useState<number | null>(() => {
    if (!exclusive) return null;
    const idx = sections.findIndex((s) => s.defaultExpanded || s.expanded);
    return idx >= 0 ? idx : null;
  });

  const handleExclusiveChange = useCallback(
    (index: number) => (expanded: boolean) => {
      if (exclusive) {
        setExpandedIndex(expanded ? index : null);
      }
    },
    [exclusive],
  );

  if (sections.length === 0) return <></>;

  return (
    <Box sx={{ flexGrow: 0, ...rootSx(variant), ...(typeof sx === "object" && !Array.isArray(sx) ? sx : {}) } as SxProps<Theme>}>
      {sections.map((section, index) => {
        const key = section.key ?? (typeof section.title === "string" ? section.title : String(index));

        // In exclusive mode, we control expanded state
        const exclusiveProps = exclusive
          ? {
              expanded: expandedIndex === index,
              onExpandedChange: handleExclusiveChange(index),
            }
          : {};

        return (
          <React.Fragment key={key}>
            {shouldShowDivider(variant, index) && <SectionDivider />}
            <SingleSectionInternal
              section={section}
              size={size}
              monospace={monospace}
              {...exclusiveProps}
            />
          </React.Fragment>
        );
      })}
    </Box>
  );
}

ExpandableSections.displayName = "ExpandableSections";

// ---------------------------------------------------------------------------
// ExpandableSection (singular) — standalone single collapsible section
// ---------------------------------------------------------------------------

export type ExpandableSectionStandaloneProps = ExpandableSection & {
  variant?: "bordered" | "plain" | "flush";
  size?: "sm" | "md" | "lg";
  monospace?: boolean;
};

export function ExpandableSectionComponent({
  variant = "bordered",
  size = "md",
  monospace = false,
  ...section
}: ExpandableSectionStandaloneProps): React.ReactElement {
  return (
    <Box sx={{ ...rootSx(variant) } as SxProps<Theme>}>
      <SingleSectionInternal
        section={section}
        size={size}
        monospace={monospace}
      />
    </Box>
  );
}

ExpandableSectionComponent.displayName = "ExpandableSection";
