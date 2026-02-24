import React from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { StyledEngineProvider } from "@mui/material/styles";

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

export const withThemeProvider = (Story, context) => {
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={darkTheme}>
        <Story />
      </ThemeProvider>
    </StyledEngineProvider>
  );
};
