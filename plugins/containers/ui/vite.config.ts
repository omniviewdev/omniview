import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const externals = [
  // MUI
  "@emotion/react",
  "@mui/joy",
  "@mui/base",
  "@mui/x-charts",
  "@mui/material",
  "@mui/material-icons",

  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",

  // OMNIVIEW
  "@omniviewdev/runtime",
]

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
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
