# Compact resource layout

Worktree: `../worktrees/compact-resource-layout`, branch `wip/compact-resource-layout`.

2026-11-27: The shell reserves a full row for scope. DataView stacks filters above search. Detail headers render the same path as the status bar, but only the header retains ancestor destinations. The proposed build moves optional scope controls into existing chrome, keeps one navigable path in the footer, and lets filters and search share width. Plugins without controls must reserve no space.

## Dev tools

The isolated preview uses the November 26 review build’s Kubernetes bundle and kind kubeconfig. It does not use the default Kubernetes context.
