import React from "react";
import { CssVarsProvider, StyledEngineProvider } from "@mui/joy/styles";

export const withThemeProvider = (Story, context) => {
  return (
    <StyledEngineProvider injectFirst>
      <CssVarsProvider
        defaultMode="dark"
        modeStorageKey="omniview_identify-system-mode"
        // Set as root provider
        disableNestedContext
      >
        <Story />
      </CssVarsProvider>
    </StyledEngineProvider>
  );
};
