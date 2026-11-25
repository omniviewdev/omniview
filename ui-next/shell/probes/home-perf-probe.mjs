// What the Home page costs with 200 connections (HM2), as a probe of its own: every assertion in it is a count, none a time. The probe is ui-next/plugins/host/probes/home-perf.mjs, with its fixture beside it; the table's scan reads only the directories
// of PROBE_DIRS (scripts/ci/probe-shards.mjs), so the unit names this wrapper (scripts/ci/probe-units/home.mjs says why), as plugins-page-perf-probe.mjs does.
await import('../../plugins/host/probes/home-perf.mjs');
