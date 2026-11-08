---
"@omniviewdev/runtime": patch
"@omniviewdev/providers": patch
---

Build the host with Go 1.27 and upgrade Go module dependencies (Wails v3.1.0, OpenTelemetry 1.47, go-plugin 1.8, MCP go-sdk 1.8, protobuf, zap and others). Require plugin-sdk v0.18.0, the matching Go 1.27 dependency upgrade release. Move `@wailsio/runtime` to 3.1.0 with the existing call-race and drag-poll patch carried over, and rebase the scoped-receive grpc-go fork onto upstream v1.85.0. Raise the production macOS minimum from 12.0 to 13.0, the new Go 1.27 floor, in bundle metadata, local/CI compilation targets, and the Homebrew cask baseline (`:ventura`). CI uses `actions/setup-go` v7 and golangci-lint v2.15.0.

Adopt the published SDK v0.18.0 in the controller's checksum-anchored release policy and raise its SDK floor to match the host dependency. Retain older reviewed tuples as history without admitting releases below the floor. Published-mode builds still verify exact module bytes and state-root capability.

Speed up workspace backend checks with isolated parallel tests, immutable Git seed copies, source-specific fixtures, and sequential reuse of refusal scenarios that preserve their inputs. Batch read-only Git identity queries and Node package resolution without caching results across inspections. Test supervisor body/EOF deadlines with a short internal policy while retaining the production timeout and durable filesystem writes.

Reduce canonical-path allocation without caching filesystem observations, retaining the standard resolver for symlinks and non-Unix platforms. Non-creation fixture setup prepares completed owned worktrees directly; dedicated creation tests retain full publication and interruption coverage. Send batched Node resolution requests over stdin so large workspaces do not exceed process argument limits.

Reduce dev-tool inspection and restoration costs without caching filesystem state. Batch committed source blobs through one Git process, combine checkout metadata and untracked discovery into one status scan, and scope package source listings. Reuse snapshot scratch buffers, avoid worker startup for one-file trees, and parse the exact journal bytes guarded by inspection's before/after check. Ownership validation, mutation admission, and durable writes remain unchanged.

Reduce workspace-suite setup further by sharing restored refusal fixtures and removing redundant warm-bootstrap passes. Keep native recovery authority tests independent of unrelated dependency installation. Preserve the large-consumer transport boundary with an explicit argument-byte budget and fewer physical consumer trees.
Limit upstream fixture registries to participating sources, and skip unrelated repository/install setup in feedback authority and process-disposal scenarios while retaining their actual native operations.
Keep source dependency refusal cases isolated and parallel, and verify that refusals retain no update or refresh intent. Retry interrupted socket-fill writes in the native Darwin exit fixture and report other socket errors.
