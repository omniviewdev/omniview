/**
 * Manually importing each built in plugin as they will be transpiled into separate chunks
 */
// const kubernetesPlugin = async () => await import('plugins/kubernetes/entry');
// const awsPlugin = async () => await import('plugins/aws/entry');
// const gcpPlugin = async () => await import('plugins/gcp/entry');
// const azurePlugin = async () => await import('plugins/azure/entry');
//
const builtInPlugins: Record<string, System.Module | (() => Promise<System.Module>)> = {
  //   // ui plugins
  //   'core:plugin/kubernetes': kubernetesPlugin,
  //   'core:plugin/aws': awsPlugin,
  //   'core:plugin/gcp': gcpPlugin,
  //   'core:plugin/azure': azurePlugin,
};

export default builtInPlugins;
