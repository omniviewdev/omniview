# Workspace skill decision evaluations

These artifacts contain actual **fresh stateless text-model responses**, not execution tests. They do not establish working CLI commands, installs, client discovery, file safety, launch, screenshots, native isolation or remote-service behavior.

## Reproduce the comparison

1. Use `fixture.json`'s system text and one skill's `evals/evals.json` prompt verbatim in a fresh `completion` call (`smol` alias). Give no tools/history and no skills for baseline.
2. Capture baseline before authoring/changing that skill. Review actual omissions, not self-reported compliance.
3. Repeat the same prompt/system in a fresh call, appending that skill's `SKILL.md` and only its referenced material. Keep all other input unchanged. Use real command/source facts, not invented helpful tools.
4. Save raw responses and independent semantic assertion grading. The assertions assess proposed IDs/paths/commands/identity/safe decisions; they are **not string searches in implementation source**. Runtime evaluation is a separate parent integration gate.

The `2026-10-17` run used one sample per variant per case. No timing/token usage was exposed by the helper; metadata records null rather than inventing measurements. Variance and actual agent/tool behavior are unmeasured. The caller supplied synthetic `/lab` paths, UUIDs and endpoint state; they are not discovered live resources. SDK revision and link-probe values remain explicit missing operator prerequisites, not fake hashes/evidence files.

## Results and human review

Open [static review](results/2026-10-17/review.html) locally. It embeds all six baseline/with-skill response pairs and decision grades. It was generated with the skill-creator static generator; no viewer server/browser/client was launched. User review/feedback has not yet occurred.

- [Raw baseline](results/2026-10-17/baseline.json): parent executed all six fresh no-skill calls before skill text was written.
- [Raw with-skill](results/2026-10-17/with-skill.json): same six prompts/system, actual canonical skill/reference content added.
- [Independent grading](results/2026-10-17/independent-grading-raw.json): six separate fresh completion graders assessed semantic decisions against the supplied assertions.
- [Adjudicated grades](results/2026-10-17/grading.json): preserves independent raw judgments and documents two overstrict baseline grades corrected in baseline's favor. Baseline already chose correct orbit/actual endpoints in case 2; case 6 already chose the allowed empty-start alternative.
- [Provenance](results/2026-10-17/metadata.json): method, unavailable measurements, exact loaded bundle hashes and evidence scope.
- [Description-only discovery](results/2026-10-17/discovery.json): eight fresh selection queries, not actual Codex/Claude client discovery.

Observed decision assertions: **8/21 baseline; 21/21 with-skill**, after the explicit baseline-favorable corrections. These are not pass counts for repository/runtime tests and not a robust benchmark. Baselines already refused wrong-target destructive operations, retained dirty work, avoided duplicate creation/commit-per-edit, distinguished DOM from pixels and scoped arbitrary plugins correctly; those are nondiscriminating successes, not invented RED failures. Actual RED gaps were exact supported command templates, precise implementation routes/shared-dependency pair, and complete disposable/profile/seed proof boundaries.

Description selection matched the exact expected set in 7/8 single samples. All four unrelated Go/React/Playwright near-misses selected no Omniview skills. The dirty Omniview SDK resume query additionally selected instance verification; this is recorded, not hidden as a perfect discovery score. No claim about repeatability, variance, latency or actual client auto-triggering follows.

After the recorded run, Main requested bounded reference alignment for the actual immutable `window.__OMNIVIEW_INSTANCE__` UUID/generation surface, passive event-proof safety (no extra `/wails/runtime.js` import), and canonical Task CLI wrappers/explicit local SDK source. Those reference additions were **not** re-evaluated under the requested source freeze. Raw transcripts, static review and metadata bundle hashes intentionally remain historical evidence for the evaluated versions, not an attestation of the subsequently aligned text.

## Remaining actual checks

Main subsequently reports actual local-installer positive/idempotence/collision/symlink-refusal checks passed. Real agent-client discovery remains separate. The parent must exercise source-defined CLI compilation/link/create/up/resume/edit/remove, real multi-plugin and dirty-SDK flows, custom-profile ownership plus baseline integration, occupied ports/failed builds, and A17 actual browser/native checks according to current integration evidence. Keep production state and credentials untouched. Real native pixels/chrome/storage need separate evidence; read-only native JS does not substitute for them.
