// Auto-generated shim for '@omniviewdev/ui/charts'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/ui/charts'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@omniviewdev/ui/charts" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BarChart = mod.BarChart;
export const GaugeCard = mod.GaugeCard;
export const MetricsPanel = mod.MetricsPanel;
export const PieChart = mod.PieChart;
export const ScatterChart = mod.ScatterChart;
export const Sparkline = mod.Sparkline;
export const StackedAreaChart = mod.StackedAreaChart;
export const TimeSeriesChart = mod.TimeSeriesChart;
export const chartPalette = mod.chartPalette;
export const formatBytes = mod.formatBytes;
export const formatDuration = mod.formatDuration;
export const formatNumber = mod.formatNumber;
export const formatPercent = mod.formatPercent;
export const formatRate = mod.formatRate;
export const formatSI = mod.formatSI;
export const formatTimeAxisTick = mod.formatTimeAxisTick;
export const getValueFormatter = mod.getValueFormatter;
export const resolveChartColor = mod.resolveChartColor;
export const useChartTheme = mod.useChartTheme;

export default mod.default !== undefined ? mod.default : mod;
