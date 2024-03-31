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
        "./CrobJobSidebar": "./src/components/kubernetes/sidebar/CronJob",
        "./EndpointSidebar": "./src/components/kubernetes/sidebar/Endpoint",
        "./IngressSidebar": "./src/components/kubernetes/sidebar/Ingress",
        "./JobSidebar": "./src/components/kubernetes/sidebar/Job",
        "./NamespaceSidebar": "./src/components/kubernetes/sidebar/Namespace",
        "./NodeSidebar": "./src/components/kubernetes/sidebar/NodeSidebar",
        "./PersistentVolumeSidebar":
          "./src/components/kubernetes/sidebar/PersistentVolumeSidebar",
        "./PersistentVolumeClaimSidebar":
          "./src/components/kubernetes/sidebar/PersistentVolumeClaimSidebar",
        "./PodSidebar": "./src/components/kubernetes/sidebar/Pod",
        "./SecretSidebar": "./src/components/kubernetes/sidebar/SecretSidebar",
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
