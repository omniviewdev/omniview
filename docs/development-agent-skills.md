# Agent workspace skills

Versioned instructions live in this host checkout under `.agents/skills`, not in a user's home directory. Skills are guidance, not evidence that launch, linking, or native integration has passed. UI implementation also has a project-local OMP completion gate and deterministic policy checks described below. The operational entry point is [development workspaces](development-workspaces.md); command definitions are in `cmd/omniview-dev/workspace_commands.go` and `control_commands.go`.

## Discover locally

From the **selected host feature checkout**, run one of:

```sh
node .agents/skills/install.mjs --client codex
node .agents/skills/install.mjs --client claude
```

Codex uses the canonical repository `.agents/skills` directly. Claude Code receives relative directory symlinks under this checkout's `.claude/skills`; no copied instructions, global links, user configuration edits, or `~/.agents` writes. Installation refuses an existing unrelated entry or symlinked parent rather than overwriting it. Run the same command in each host feature checkout where discovery is needed. Start the agent in that checkout, not in a canonical sibling or arbitrary `/tmp` directory. Restart or refresh the client's skill discovery after installation as required by that client.

| Request | Skill |
| --- | --- |
| Set up/start/resume/edit/link/stop/remove a feature | `omniview-workspaces` |
| Find the repository and source for a feature or bug | `omniview-repo-map` |
| Verify browser/native behavior on the correct instance | `omniview-instance-verification` |
| Design a UI change with grounded mocks, a clickable prototype, screenshots or an issue write-up | `omniview-ui-mocks` |
| Profile actual host/plugin workloads | `omniview-performance-profiling` |
| Build, migrate, fix, or audit UI while preserving approved composition | `omniview-ui-implementation` |

Claude Code can invoke the installed skills by name, including `/omniview-ui-implementation`. In Codex, ask it to use the corresponding skill (or select it in that client's skills UI). If a client cannot discover a skill, open its `SKILL.md` explicitly; do not install globally as a fallback. OMP discovers the canonical UI skill as `agents:project` and the auditor from `.omp/agents`; its automatic completion enforcement is separate from skill selection. Claude/Codex installation does not install an equivalent runtime gate.

## Minimal handoff to an agent

Provide the collection root and feature name/UUID or manifest path. For a new collection, provide explicit source IDs and clone paths. Normal clones and bare repositories with a main worktree are supported; clone names and parent-directory layouts are not authority. Source registry `.omniview-dev/repositories.json` selects the actual sources; `workspace paths` resolves the feature checkouts before any edit.

For launch, select a local SDK checkout and supply the **actual successful pinned package-link protocol probe JSON**. Do not fabricate evidence or assume a help invocation proves readiness. The workspace observes the SDK checkout's HEAD and dirty-source digest, including isolation-boundary edits; this is not a sandbox.

From the host checkout, capture the actual CLI path once, then invoke that immutable executable:

```sh
DEV="$(task --silent dev:cli:build)"
"$DEV" workspace inspect "$FEATURE" --root "$COLLECTION" --json
```

The helper builds outside source in the private OS user cache and prints the actual path; do not guess `$PWD/bin/omniview-dev` or create an alias. Ordinary bootstrap uses the published SDK requirement. Select local SDK development explicitly through `SDK_SOURCE`; an enclosing workspace may derive it only from its canonical manifest, never a guessed sibling.

For an existing feature, `task dev -- ...` wraps canonical `workspace up` (native default; `SERVER=true` browser; `WAILS_MCP=1` native MCP). Task dev/workspace wrappers capture the helper once internally, without extra path output contaminating JSON. Forward selection and real launch prerequisites after `--`; do not run a separate `wails dev` supervisor.

Declared dependencies define the source contract: the host `go.mod` resolves the SDK commit for E2E and application profiling, the host lockfile selects UI packages, and the host gitlink selects Kubernetes. Local development workspaces use their selected SDK checkout and record its identity and source digest.

A useful request is: “Use omniview-workspaces. Collection ROOT, feature NAME; select host, UI, SDK, Kubernetes and this second registered plugin. Start browser mode, report actual paths/UUID/generation/endpoints and any unverified boundary.” Plugin repository IDs and `plugin.yaml` plugin IDs are distinct; repeat both selections for multiple plugins.

## Evidence and safety

- No context-file changes or global skill installation are necessary.
- Real owned browser launch, concurrent native A/B/production-tagged windows, warm restart and canonical feature retirement have been exercised for earlier companion sources. This does not establish every consumer-refresh, platform or source-ref combination; consult retained integration evidence rather than treating help output or command examples as exercised successes.
- Fresh-context model decision evaluations and their provenance are versioned under `.agents/skills/evals/` (additional handoff artifacts under `.superpowers/sdd/2026-10-17-agentic-workspaces/a18-*`). The 21/21 result applies to the recorded text-model scenarios, not executed CLI, filesystem, browser, screenshot, cluster, or native tests. Subsequent bounded reference alignment is documented separately and has not been re-evaluated.
- Missing/ambiguous workspace context, wrong UUID/generation, occupied ports, failed builds, and missing link/trust evidence fail closed. A healthy listener is not an owned instance.
- Baseline seeding is explicit and offline; never copy a running profile's database/tree or connect to a real cluster automatically. Removal preserves state and branches by default and refuses dirty/user work rather than forcing cleanup.

Local discovery behavior is based on the [Codex skills documentation](https://developers.openai.com/codex/skills) and [Claude Code project skills/symlink documentation](https://code.claude.com/docs/en/skills#where-skills-live). Main reports actual installer positive/idempotence/collision/symlink-refusal checks passed. Actual agent-client discovery remains a separate check; neither documentation support nor installer checks mean those clients were launched here.

## UI implementation and independent acceptance

The [UI implementation skill](../.agents/skills/omniview-ui-implementation/SKILL.md) and [audit protocol](../.agents/skills/omniview-ui-implementation/references/audit-protocol.md) preserve appearance, interactions, information, density, and responsiveness. A library migration does not authorize redesign. The [metrics V01–V11 case](../.agents/skills/omniview-ui-implementation/references/metrics-regression-case.md) records why correct imports, passing functional checks, and opened screenshots were insufficient.

### OMP automatic gate

Start a fresh OMP session in this checkout with dependencies installed and ambient project extensions enabled. `.omp/hooks/pre/ui-audit.ts` registers `ui_audit_snapshot` and `ui_audit_submit` and blocks `session_stop` for unaudited UI changes. `agent_end` is not used as a gate. Existing sessions must reload extensions or restart; creating these files does not retroactively enable a hook.

The initial session snapshot preserves preexisting user changes. Later shell, external-editor, child-agent, untracked, deleted, CSS, source, dependency, policy, or auditor changes invalidate approval. The baseline persists per worktree and session so resuming the same session cannot erase a blocked change. A genuinely new session establishes a new baseline; this local guard is not a repository-wide release attestation.

For a feature collection, the parent `workspace.json` must explicitly select the current Git root. The gate then fingerprints all selected Git roots and the manifest, without guessing sibling repositories. The snapshot reports those roots. Unselected repositories are outside that audit; select them in the canonical manifest before work. For a standalone checkout only that Git root is covered.

The parent inspects `ui_audit_snapshot({})`, then dispatches a direct `omniview-ui-auditor` child. The auditor reads the current source and approved contract, exercises the authenticated actual UI, compares real pixels, and submits through `ui_audit_submit`. Four verdicts must pass: library compliance, composition parity, information/interaction preservation, and visual acceptance. A missing browser, missing baseline, unresolved blocking finding, stale snapshot, or unverified required state blocks approval. Do not fabricate pixels or repeatedly retry an unchanged failure.

The agent template selects high effort. Submission checks actual runtime effort (high/xhigh/max) and model identity rather than trusting report claims. Configure a compatible model; lowering effort or using a model without the required runtime evidence cannot produce approval. Reports and actionable library requests persist under the worktree Git directory's `ui-audit/<session hash>/`; tool responses return the receipt path. Parents cannot self-attest. Approved exceptions require explicit approval evidence; a library ticket alone never authorizes a workaround.

Check tool availability before relying on enforcement. Disabled extensions, missing hook files, unsupported agent clients, or writes outside selected roots cannot be covered by this local gate. Same-user files and eval are not sandboxed. Image signatures and hashes reject renamed text and bind bytes, but do not prove screenshot provenance or visual correctness. Independent judgment and human approval remain necessary.

### Deterministic checks and CI

```sh
pnpm lint:ui-policy
node scripts/ui-audit/check.mjs --base origin/main
pnpm test:ui-audit
pnpm smoke:ui-audit --output /absolute/path/ui-audit-smoke.json
```

`pnpm lint` includes the policy checker. It flags newly introduced native controls, browser-native datetime use behind supported library wrappers, legacy UI imports, and explicit control resets. It parses source/CSS and resolves bindings; it does not establish visual quality, arbitrary token validity, every dynamic construction, or correct domain semantics. Structural HTML and domain colors remain allowed. Tests/stories/generated files and designated library implementations are not application-control violations.

Locally, the default baseline is HEAD, with staged, unstaged, and untracked files included. In GitHub PR CI, `GITHUB_BASE_REF` selects the merge-base against the fetched remote base; an unavailable base fails closed. `--base` permits an explicit baseline. New duplicate violations cannot hide behind legacy debt. Existing lint CI gains these static checks, not an automatic model/pixel audit or server-side branch protection.

The smoke invokes the installed OMP CLI and configured model against an owned disposable fixture. It is a runtime gate test, not an Omniview application visual test. Review [evaluation provenance and raw results](../.agents/skills/omniview-ui-implementation-workspace/README.md) and the [skill-creator viewer](../.agents/skills/omniview-ui-implementation-workspace/iteration-1/review.html). Text-model decision improvements do not establish runtime or visual correctness.

