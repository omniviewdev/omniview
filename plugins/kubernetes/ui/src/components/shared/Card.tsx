import React from "react";

// material-ui
import {
  Stack,
  Card as MuiCard,
  CardContent,
  Chip,
  Avatar,
  Divider,
  Typography,
} from '@mui/joy';

// project imports
import Icon from "./Icon";

export interface Props {
  title: string;
  icon?: string | React.ReactNode;
  titleDecorator?: string | number | React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Renders a card for showing a key-value pairs of details
 */
export const Card: React.FC<Props> = ({
  title,
  titleDecorator,
  icon,
  children,
}) => {
  return (
    <MuiCard variant="outlined" sx={{ p: 0, gap: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        p={1}
        alignItems={"center"}
        justifyContent={"space-between"}
      >
        <Stack direction="row" alignItems={"center"} spacing={1}>
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
        {titleDecorator &&
          (typeof titleDecorator === "string" ||
            typeof titleDecorator === "number" ? (
            <Chip
              sx={{ borderRadius: "4px" }}
              size="sm"
              color="primary"
              variant="outlined"
            >
              {titleDecorator}
            </Chip>
          ) : (
            titleDecorator
          ))}
      </Stack>
      <Divider />
      <CardContent>{children}</CardContent>
    </MuiCard>
  );
};

Card.displayName = "Card";

export default Card;
