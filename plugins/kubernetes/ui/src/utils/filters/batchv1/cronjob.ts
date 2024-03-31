import { CronJob } from "kubernetes-types/batch/v1";
import { Secret } from "kubernetes-types/core/v1";

export const cronjobUsesSecret = (job: CronJob, secret: Secret): boolean => {
  if (secret === undefined) {
    return false;
  }

  if (job?.spec?.jobTemplate?.spec?.template?.spec?.volumes) {
    return job.spec.jobTemplate.spec.template.spec.volumes.some((volume) => {
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
