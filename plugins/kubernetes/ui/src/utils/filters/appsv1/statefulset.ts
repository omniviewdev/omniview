import { StatefulSet } from "kubernetes-types/apps/v1";
import { Secret } from "kubernetes-types/core/v1";

// Various filters for find linked resources based on the statefulset
export const statefulSetUsesSecret = (
  statefulset: StatefulSet,
  secret: Secret,
): boolean => {
  if (secret === undefined) {
    return false;
  }

  if (statefulset?.spec?.template?.spec?.volumes) {
    return statefulset.spec.template.spec.volumes.some((volume) => {
      if (
        volume.secret &&
        volume.secret.secretName === secret?.metadata?.name
      ) {
        return true;
      }
    });
  }

  // check the envFrom and env fields
  if (statefulset?.spec?.template?.spec?.containers) {
    return statefulset.spec.template.spec.containers.some((container) => {
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
