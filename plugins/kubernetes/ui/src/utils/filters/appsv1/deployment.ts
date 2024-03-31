import { Deployment } from "kubernetes-types/apps/v1";
import { Secret } from "kubernetes-types/core/v1";

// Various filters for find linked resources based on the deployment
export const deplomentUsesSecret = (
  deployment: Deployment,
  secret: Secret,
): boolean => {
  if (secret === undefined) {
    return false;
  }

  if (deployment?.spec?.template?.spec?.volumes) {
    return deployment.spec.template.spec.volumes.some((volume) => {
      if (
        volume.secret &&
        volume.secret.secretName === secret?.metadata?.name
      ) {
        return true;
      }
    });
  }

  // check the envFrom and env fields
  if (deployment?.spec?.template?.spec?.containers) {
    return deployment.spec.template.spec.containers.some((container) => {
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
