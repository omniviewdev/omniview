import React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import Icon from "./Icon";

export interface ExpandableSection {
  icon?: string | React.ReactNode;
  title: string;
  endDecorator?: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

interface Props {
  sections: Array<ExpandableSection>;
  monospace?: boolean;
}

/**
 * A group of expandable accordion sections with icon support.
 */
export default function ExpandableSections({
  sections,
  monospace = false,
}: Props): React.ReactElement {
  return (
    <Box
      sx={{
        borderRadius: "4px",
        border: "1px solid var(--ov-border-default)",
        flexGrow: 0,
        "& .MuiAccordion-root": {
          transition: "0.2s ease",
          boxShadow: "none",
          "&:before": { display: "none" },
          "& .MuiAccordionSummary-root:hover": {
            background: "transparent",
          },
        },
        "& .MuiAccordion-root.Mui-expanded": {
          bgcolor: "var(--ov-bg-surface-raised)",
          borderRadius: "4px",
        },
      }}
    >
      {sections.map((section) => (
        <Accordion
          key={section.title}
          defaultExpanded={section.defaultExpanded}
          disableGutters
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ pl: 0.5, minHeight: 40 }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              justifyContent="space-between"
              width="100%"
            >
              <Chip
                size="medium"
                variant="filled"
                sx={{
                  borderRadius: "4px",
                  bgcolor: "var(--ov-bg-surface-raised)",
                  color: "var(--ov-fg-default)",
                }}
                icon={
                  section.icon
                    ? typeof section.icon === "string"
                      ? section.icon.startsWith("http")
                        ? (
                          <Avatar
                            src={section.icon}
                            sx={{
                              height: 16,
                              width: 16,
                              borderRadius: "2px",
                              ml: "0px",
                            }}
                          />
                        )
                        : <Icon name={section.icon} size={14} />
                      : (section.icon as React.ReactElement)
                    : undefined
                }
                label={
                  <Typography
                    sx={{
                      fontFamily: monospace ? "monospace" : "inherit",
                      px: 0.5,
                      color: "var(--ov-fg-base)",
                      fontSize: monospace ? 13 : 14,
                    }}
                  >
                    {section.title}
                  </Typography>
                }
              />
              {section.endDecorator && section.endDecorator}
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>{section.children}</AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
