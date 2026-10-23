---
name: omniview-workspaces
description: Use when setting up, starting, selecting, resuming, editing, linking, stopping, or removing an Omniview multi-repository feature workspace, including multiple plugins, dirty SDK edits, custom state roots, or failed launch recovery.
---

# Omniview workspaces

Read [lifecycle](references/lifecycle.md) for source-defined commands; [safety](references/safety.md) for seeding, custom roots, or removal. Commands are not evidence of execution; integrated launch still needs actual verification.

1. Select explicit collection `--root` and workspace name/UUID or manifest. If context is absent/conflicting, resolve it first; never fall back to production. Read the source registry, not every clone.
2. For new work, select registered repository IDs and separate committed `plugin.yaml` IDs. Use one `workspace create NAME --start` with needed repos/plugins and real SDK/link prerequisites. For existing work, inspect the same UUID; do not create duplicates.
3. Resolve `workspace paths` before edits. The per-feature pnpm12 aggregate is owned; do not hand-edit it or run a second child installer. Preserve dirty SDK source without commit-per-edit. Reconcile failed builds through current plugin generation, not host generation or an old health port.
4. Report actual UUID, feature paths, state root, generation, endpoints, operation/readiness and remaining evidence. Missing prerequisites are blockers, not fabricated values.

Use **omniview-repo-map** for source routing and **omniview-instance-verification** before verification/mutation. Never replace supported lifecycle commands with global links, force cleanup, or unexecuted `--help` assumptions.
