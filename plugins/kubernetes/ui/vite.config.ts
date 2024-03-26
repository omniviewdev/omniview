import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "kubernetes",
      filename: "remoteEntry.js",
      exposes: {
        "./PodSidebar": "./src/components/kubernetes/sidebar/PodSidebar",
      },
      shared: ["react", "react-dom", "@mui/joy", "@emotion/react"],
    }),
  ],
  build: {
    modulePreload: false,
    target: "esnext",
    minify: false,
    cssCodeSplit: false,
  },
});
