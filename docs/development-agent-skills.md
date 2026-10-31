# Agent workspace skills

Versioned instructions live in this host checkout under `.agents/skills`, not in a user's home directory. They are opt-in guidance, not evidence that launch, linking, or native integration has passed. The operational entry point is [development workspaces](development-workspaces.md); command definitions are in `cmd/omniview-dev/workspace_commands.go` and `control_commands.go`.

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

Claude Code can invoke `/omniview-workspaces`, `/omniview-repo-map`, `/omniview-instance-verification`, or `/omniview-ui-mocks`. In Codex, ask it to use the corresponding skill (or select it in that client's skills UI). If the client cannot discover a skill, open its `SKILL.md` explicitly; do not install globally as a fallback. For clients other than these two, explicitly attach/read the canonical file; automatic discovery has not been established here.

## Minimal handoff to an agent

Provide the collection root and feature name/UUID or manifest path. For a new collection, provide explicit source IDs and clone paths. Normal clones and bare repositories with a main worktree are supported; clone names and parent-directory layouts are not authority. Source registry `.omniview-dev/repositories.json` selects the actual sources; `workspace paths` resolves the feature checkouts before any edit.

For launch, also supply an independently reviewed full fixed-capability SDK revision and the **actual successful pinned package-link protocol probe JSON**. Do not fabricate these values or assume a help invocation proves readiness. Ordinary dirty SDK source edits do not require a commit per edit. Isolation-boundary changes require explicit review and `--allow-isolation-source-changes`, not a silent bypass.

From the host checkout, capture the actual CLI path once, then invoke that immutable executable:

```sh
DEV="$(task --silent dev:cli:build)"
"$DEV" workspace inspect "$FEATURE" --root "$COLLECTION" --json
```

The helper builds outside source in the private OS user cache and prints the actual path; do not guess `$PWD/bin/omniview-dev` or create an alias. Ordinary bootstrap uses the published SDK requirement. Select local SDK development explicitly through `SDK_SOURCE`; an enclosing workspace may derive it only from its canonical manifest, never a guessed sibling.

For an existing feature, `task dev -- ...` wraps canonical `workspace up` (native default; `SERVER=true` browser; `WAILS_MCP=1` native MCP). Task dev/workspace wrappers capture the helper once internally, without extra path output contaminating JSON. Forward selection and real launch prerequisites after `--`; do not run a separate `wails dev` supervisor.

Published SDK `v0.6.0` resolves to reviewed commit `1e92fb518b117814acb504aaae1772ff39abcdef` and contains the shared profile contract required by this host. Its module and checksum have been verified through the public Go proxy. Earlier Task lifecycle evidence used the pre-release integration commit recorded in the roadmap; that evidence is not a claim of a fresh full lifecycle run against every subsequent release.

A useful request is: “Use omniview-workspaces. Collection ROOT, feature NAME; select host, UI, SDK, Kubernetes and this second registered plugin. Start browser mode, report actual paths/UUID/generation/endpoints and any unverified boundary.” Plugin repository IDs and `plugin.yaml` plugin IDs are distinct; repeat both selections for multiple plugins.

## Evidence and safety

- No context-file changes or global skill installation are necessary.
- Real owned browser launch, concurrent native A/B/production-tagged windows, warm restart and canonical feature retirement have been exercised for the reviewed companion-source cohort. This does not establish every consumer-refresh, platform or source-ref combination; consult retained integration evidence rather than treating help output or command examples as exercised successes.
- Fresh-context model decision evaluations and their provenance are versioned under `.agents/skills/evals/` (additional handoff artifacts under `.superpowers/sdd/2026-10-17-agentic-workspaces/a18-*`). The 21/21 result applies to the recorded text-model scenarios, not executed CLI, filesystem, browser, screenshot, cluster, or native tests. Subsequent bounded reference alignment is documented separately and has not been re-evaluated.
- Missing/ambiguous workspace context, wrong UUID/generation, occupied ports, failed builds, and missing link/trust evidence fail closed. A healthy listener is not an owned instance.
- Baseline seeding is explicit and offline; never copy a running profile's database/tree or connect to a real cluster automatically. Removal preserves state and branches by default and refuses dirty/user work rather than forcing cleanup.

Local discovery behavior is based on the [Codex skills documentation](https://developers.openai.com/codex/skills) and [Claude Code project skills/symlink documentation](https://code.claude.com/docs/en/skills#where-skills-live). Main reports actual installer positive/idempotence/collision/symlink-refusal checks passed. Actual agent-client discovery remains a separate check; neither documentation support nor installer checks mean those clients were launched here.
