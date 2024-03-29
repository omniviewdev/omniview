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
        "./ConfigMapSidebar":
          "./src/components/kubernetes/sidebar/ConfigMapSidebar",
        "./NodeSidebar": "./src/components/kubernetes/sidebar/NodeSidebar",
        "./PersistentVolumeSidebar":
          "./src/components/kubernetes/sidebar/PersistentVolumeSidebar",
        "./PersistentVolumeClaimSidebar":
          "./src/components/kubernetes/sidebar/PersistentVolumeClaimSidebar",
        "./PodSidebar": "./src/components/kubernetes/sidebar/PodSidebar",
        "./SecretSidebar": "./src/components/kubernetes/sidebar/SecretSidebar",
        "./IngressSidebar":
          "./src/components/kubernetes/sidebar/IngressSidebar",
      },
      shared: [
        "react",
        "react-dom",
        "@mui/joy",
        "@emotion/react",
        "@monaco-editor/react",
        "monaco-editor",
      ],
    }),
  ],
  build: {
    modulePreload: false,
    target: "esnext",
    minify: false,
    cssCodeSplit: false,
  },
});
