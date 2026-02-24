import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

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
  "@tanstack/react-query",

  // OMNIVIEW
  "@omniviewdev/runtime",
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
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    omniviewExternals(),
  ],
  server: {
    host: '127.0.0.1',
    port: 15173,
    cors: true,
    strictPort: false,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/entry.ts",
      output: {
        entryFileNames: "assets/entry.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: 'system',
        globals: {
          'react': 'react',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'react/jsx-runtime',
        },
      },
      preserveEntrySignatures: 'strict',
      external: externals,
    }
  },
});
