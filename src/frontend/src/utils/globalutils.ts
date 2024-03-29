import { DetectLanguage } from '@api/utils/Client';

/* @ts-expect-error - assigning utilities  */
window.detectLanguage = async function ({ filename, contents }) {
  return DetectLanguage({ filename, contents });
};
