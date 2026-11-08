# UI implementation skill evaluations

## Decision evaluation

Open [skill-creator review](iteration-1/review.html). This is the actual skill-creator static viewer, with paired raw responses and semantic grades.

Four prompts cover metrics migration parity, pressure to create local substitutes, valid near-misses, and stale/missing evidence. Each variant used one fresh stateless completion with identical prompt and system text; only the skill/reference bundle differed. Eight further fresh completion calls graded assertions independently.

| Variant | Passed assertions | Total |
| --- | --- | --- |
| With skill | 18 | 18 |
| Without skill | 13 | 18 |

The `smol` tier was unavailable; both variants used the default model. Token usage and provider execution timing were unavailable and remain null. The viewer shows the unweighted mean across cases, not the assertion-weighted total above. Variation across cases is not repeat-run reliability.

A baseline-favorable adjudication accepts the baseline's demand to restore the segmented control: the prompt did not supply installed API inventory, so withholding an API-sufficiency claim is not a failure. Original independent grades remain in `iteration-1/independent-grading-raw.json`.

Actual baseline gaps: identity versus dimensions, shared spacing/density ownership, acceptance of a local trigger CSS workaround, browser-native temporal substitution, and narrow-table density verification. Valid-near-miss and stale-evidence cases passed both variants; these are nondiscriminating safety controls, not evidence of improvement.

Metadata-only triggering selected the expected skill in both UI cases and rejected both backend-only cases (4/4 single samples). `iteration-1/discovery.json` retains responses. Separately, actual `omp skill list --json` discovered the canonical file as `agents:project`; `iteration-1/runtime-discovery.json` records that observation. Neither result establishes Claude/Codex client invocation.

`iteration-1/metadata.json` records system text and the exact evaluated skill-bundle hash. Do not claim subsequent skill edits were evaluated under that hash without rerunning. Human feedback has not yet been collected; the viewer supports review. These results measure proposed decisions only—not actual agent tool use, automatic discovery, visual judgment, or successful application acceptance.

## Runtime and policy verification

Run deterministic state/CLI regressions with `pnpm test:ui-audit`. Run the actual OMP lifecycle smoke with:

```sh
pnpm smoke:ui-audit --output .agents/skills/omniview-ui-implementation-workspace/runtime-smoke.json
```

The smoke uses the installed OMP CLI and configured model credentials. It creates and removes an owned temporary Git checkout, exposes the actual project hook, mutates only fixture CSS, attempts parent self-attestation, observes completion blocking, restores the fixture, and exercises an independent high-effort child's missing-visual-evidence submission. It does not launch Omniview or claim native/browser visual acceptance. The output records actual events and explicit scope; `passed: false` means an incomplete/failed smoke, not approval.

Successful acceptance, stale approval, untracked/shell writes, resumed baselines, selected sibling repos, CI merge-base selection, approved exceptions, and malformed evidence are also checked through isolated deterministic tests. Pixel magic bytes prevent renamed text from passing as an image; they cannot prove capture provenance or visual quality. Those remain independent auditor responsibilities.

Observed on 2026-11-06: all 39 deterministic tests passed; `pnpm lint:ui-policy` passed; skill-creator validation passed. The cleaned actual-runtime smoke passed under OMP v18.17.0. Its independent child ran `openai-codex/gpt-6.1-sol` with runtime-reported `thinkingLevel: high`, persisted an unverified report, and received no approval. Completion was observed first with changed UI and then after fixture restoration. Raw evidence is retained in [runtime-smoke.json](runtime-smoke.json). No successful production visual acceptance is implied.
