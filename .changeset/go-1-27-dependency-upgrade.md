---
---

Build the host with Go 1.27 and upgrade Go module dependencies (OpenTelemetry 1.47, go-plugin 1.8, MCP go-sdk 1.8, protobuf, zap and others; Wails and the scoped grpc-go/cel-go forks are unchanged). Raise the production macOS minimum from 12.0 to 13.0, the new Go 1.27 floor, in bundle metadata, local/CI compilation targets, and the Homebrew cask baseline (`:ventura`). CI uses `actions/setup-go` v7 and golangci-lint v2.15.0.
