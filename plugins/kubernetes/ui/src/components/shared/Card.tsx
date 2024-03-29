import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";
import MuiCard from "@mui/joy/Card";
import CardContent from "@mui/joy/CardContent";
import Avatar from "@mui/joy/Avatar";
import Divider from "@mui/joy/Divider";
import Typography from "@mui/joy/Typography";

// project imports
import Icon from "./Icon";

export interface Props {
  title: string;
  icon?: string | React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Renders a card for showing a key-value pairs of details
 */
export const Card: React.FC<Props> = ({ title, icon, children }) => {
  return (
    <MuiCard variant="outlined" sx={{ p: 1, gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems={"center"}>
        {icon &&
          (typeof icon === "string" ? (
            icon.startsWith("http") ? (
              <Avatar
                src={icon}
                size="sm"
                sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
              />
            ) : (
              <Icon name={icon} size={14} />
            )
          ) : (
            icon
          ))}
        <Typography level="title-sm">{title}</Typography>
      </Stack>
      <Divider />
      <CardContent>{children}</CardContent>
    </MuiCard>
  );
};

Card.displayName = "Card";

export default Card;
