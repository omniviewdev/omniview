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
        "./ControllerRevisionSidebar":
          "./src/components/kubernetes/sidebar/appsv1/ControllerRevision",
        "./CrobJobSidebar": "./src/components/kubernetes/sidebar/CronJob",
        "./DaemonSetSidebar":
          "./src/components/kubernetes/sidebar/appsv1/DaemonSet",
        "./DeploymentSidebar":
          "./src/components/kubernetes/sidebar/appsv1/Deployment",
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
        "./ReplicaSetSidebar":
          "./src/components/kubernetes/sidebar/appsv1/ReplicaSet",
        "./SecretSidebar": "./src/components/kubernetes/sidebar/SecretSidebar",
        "./StatefulSetSidebar":
          "./src/components/kubernetes/sidebar/appsv1/StatefulSet",
        "./ContainerStatusCell": "./src/components/kubernetes/table/corev1/Pod/ContainerStatusCell",
      },
      shared: [
        "react",
        "react-dom",
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
