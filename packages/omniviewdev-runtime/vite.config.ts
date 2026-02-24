import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const externals = [
  // MUI
  "@emotion/react",
  "@mui/material",
  "@mui/material/styles",
  "@mui/material/Box",
  "@mui/material/Grid",
  "@mui/material/GlobalStyles",
  "@mui/material/CssBaseline",
  "@mui/material/CircularProgress",
  "@mui/material/LinearProgress",
  "@mui/material/Divider",
  "@mui/icons-material",

  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",
  "notistack",
  "@tanstack/react-query",

  // OMNIVIEW
  "@omniviewdev/ui",
  "@omniviewdev/ui/buttons",
  "@omniviewdev/ui/inputs",
  "@omniviewdev/ui/feedback",
  "@omniviewdev/ui/typography",
  "@omniviewdev/ui/overlays",
  "@omniviewdev/ui/navigation",
  "@omniviewdev/ui/table",
  "@omniviewdev/ui/layout",
  "@omniviewdev/ui/domain",
  "@omniviewdev/ui/charts",
  "@omniviewdev/ui/editors",
  "@omniviewdev/ui/types",
  "@omniviewdev/ui/theme",
  "@omniviewdev/ui/menus",
  "@omniviewdev/ui/sidebars",
  "@omniviewdev/ui/cells",
]

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: [
        resolve(__dirname, "src/index.ts"),
        resolve(__dirname, "src/api.ts"),
        resolve(__dirname, "src/models.ts"),
        resolve(__dirname, "src/runtime.ts"),
      ],
      name: "@omniview/runtime",
    },
    rollupOptions: {
      external: externals,
      output: {
        globals: {
          'react': 'react',
          'react-dom': 'ReactDOM',
          'react-router-dom': 'ReactRouterDOM',
          'react/jsx-runtime': 'react/jsx-runtime',
          'notistack': 'notistack',
        },
      },
    }
  },
  plugins: [
    react(),
    dts({ tsconfigPath: './tsconfig.app.json' })
  ],
});
