---
"@omniviewdev/runtime": patch
"@omniviewdev/providers": patch
---

Build the host with Go 1.27 and upgrade Go module dependencies (Wails v3.1.0, OpenTelemetry 1.47, go-plugin 1.8, MCP go-sdk 1.8, protobuf, zap and others). Move `@wailsio/runtime` to 3.1.0 with the existing call-race and drag-poll patch carried over, and rebase the scoped-receive grpc-go fork onto upstream v1.85.0. Raise the production macOS minimum from 12.0 to 13.0, the new Go 1.27 floor, in bundle metadata, local/CI compilation targets, and the Homebrew cask baseline (`:ventura`). CI uses `actions/setup-go` v7 and golangci-lint v2.15.0.
