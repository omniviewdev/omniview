/** Globals the bench page modules share through `window`. */
interface Window {
  /** Config the runner (or the `ovbench` query parameter, via the build's bootstrap script) gives the page. */
  __OV_BENCH__?: import('./fake-backend').BenchConfig;
  /** The boot identity a native host embeds in index.html; the bootstrap script defines it on request. */
  __OMNIVIEW_INSTANCE__?: { instanceID: string; displayName: string; generation: string; kind: string };
  /** React commit totals; only the profiling build installs it. */
  __ovProfile?: import('./profiler').ProfileApi;
  /** Controls and sampler for runners and native WebViews; see `help()`. */
  __ovBench?: object;
}
