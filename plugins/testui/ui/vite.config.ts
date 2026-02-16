import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

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
  "@tanstack/react-query",

  // OMNIVIEW
  "@omniviewdev/runtime",
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
