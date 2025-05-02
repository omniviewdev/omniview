import { UtilsClient } from '@omniviewdev/runtime/api';

/* @ts-expect-error - assigning utilities  */
window.detectLanguage = async function ({ filename, contents }) {
  return UtilsClient.DetectLanguage({ filename, contents });
};
