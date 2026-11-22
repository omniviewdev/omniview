// The Plugins page probe (PL1) lives with the page, in ui-next/shell/plugins-page/probes/; this file is the name CI runs it by, in a directory the table's scan reads (PROBE_DIRS in scripts/ci/probe-shards.mjs).
await import('../plugins-page/probes/plugins-probe.mjs');
