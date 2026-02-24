import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const externals = [
  // MUI
  "@emotion/react",
  "@emotion/styled",
  "@mui/material",
  "@mui/icons-material",
  "@mui/icons-material/Search",
  "@mui/icons-material/SearchRounded",
  "@mui/icons-material/Close",
  "@mui/icons-material/Clear",

  // MUI X Charts
  "@mui/x-charts",
  "@mui/x-charts/LineChart",
  "@mui/x-charts/BarChart",
  "@mui/x-charts/PieChart",
  "@mui/x-charts/ScatterChart",
  "@mui/x-charts/SparkLineChart",
  "@mui/x-charts/Gauge",
  "@mui/x-charts/ChartsReferenceLine",

  // React
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-icons",
  "react-icons/lib",
  "react-icons/lu",
  "react-icons/si",

  // TanStack
  "@tanstack/react-table",

  // Utilities
  "date-fns",

  // Editors
  "monaco-editor",
  "@monaco-editor/react",
  "@xterm/xterm",
  "@xterm/addon-fit",
  "@xterm/addon-webgl",
];

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        cells: resolve(__dirname, "src/cells/index.ts"),
        table: resolve(__dirname, "src/table/index.ts"),
        inputs: resolve(__dirname, "src/inputs/index.ts"),
        utils: resolve(__dirname, "src/utils/index.ts"),
        theme: resolve(__dirname, "src/theme/index.ts"),
        types: resolve(__dirname, "src/types/index.ts"),
        buttons: resolve(__dirname, "src/buttons/index.ts"),
        feedback: resolve(__dirname, "src/feedback/index.ts"),
        typography: resolve(__dirname, "src/typography/index.ts"),
        overlays: resolve(__dirname, "src/overlays/index.ts"),
        navigation: resolve(__dirname, "src/navigation/index.ts"),
        editors: resolve(__dirname, "src/editors/index.ts"),
        domain: resolve(__dirname, "src/domain/index.ts"),
        layout: resolve(__dirname, "src/layout/index.ts"),
        menus: resolve(__dirname, "src/menus/index.ts"),
        sidebars: resolve(__dirname, "src/sidebars/index.ts"),
        charts: resolve(__dirname, "src/charts/index.ts"),
      },
      name: "@omniviewdev/ui",
    },
    rollupOptions: {
      external: (id) =>
        externals.some(
          (ext) => id === ext || id.startsWith(ext + "/")
        ),
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react/jsx-runtime": "react/jsx-runtime",
        },
      },
    },
  },
  plugins: [
    react(),
    dts({ tsconfigPath: "./tsconfig.app.json" }),
    viteStaticCopy({
      targets: [
        {
          src: "src/theme/tokens.css",
          dest: ".",
        },
      ],
    }),
  ],
});
