import { Pod, Secret } from "kubernetes-types/core/v1";

export const podUsesSecret = (pod: Pod, secret: Secret): boolean => {
  if (secret === undefined) {
    return false;
  }
  if (pod?.spec?.volumes) {
    return pod.spec.volumes.some((volume) => {
      if (
        volume.secret &&
        volume.secret.secretName === secret?.metadata?.name
      ) {
        return true;
      }
    });
  }
  return false;
};
