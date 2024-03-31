import { DaemonSet } from "kubernetes-types/apps/v1";
import { Secret } from "kubernetes-types/core/v1";

export const daemonSetUsesSecret = (
  daemonset: DaemonSet,
  secret: Secret,
): boolean => {
  if (secret === undefined) {
    return false;
  }
  if (daemonset?.spec?.template?.spec?.volumes) {
    return daemonset.spec.template.spec.volumes.some((volume) => {
      if (
        volume.secret &&
        volume.secret.secretName === secret?.metadata?.name
      ) {
        return true;
      }
    });
  }

  // check the envFrom and env fields
  if (daemonset?.spec?.template?.spec?.containers) {
    return daemonset.spec.template.spec.containers.some((container) => {
      if (
        container.envFrom &&
        container.envFrom.some((envFrom) => {
          if (
            envFrom.secretRef &&
            envFrom.secretRef.name === secret?.metadata?.name
          ) {
            return true;
          }
        })
      ) {
        return true;
      }
      if (
        container.env &&
        container.env.some((env) => {
          if (
            env.valueFrom &&
            env.valueFrom.secretKeyRef &&
            env.valueFrom.secretKeyRef.name === secret?.metadata?.name
          ) {
            return true;
          }
        })
      ) {
        return true;
      }
    });
  }
  return false;
};
