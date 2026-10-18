---
name: omniview-instance-verification
description: Use when verifying or attaching to an Omniview browser/native instance, collecting UI or backend evidence, diagnosing stale endpoints/readiness, or preparing tests that could reset settings, close terminals, or access plugin connections.
---

# Verify the intended instance

Use explicit selection, then compare live authenticated identity:

```sh
omniview-dev workspace inspect "$FEATURE" --root "$COLLECTION" --json
omniview-dev instance inspect --workspace "$FEATURE" --root "$COLLECTION" --json
```

Require manifest UUID, state root, instance UUID, **current generation**, owned process identity, endpoint and private-token authenticated control agreement. Wrong/missing identity means **no mutation**; `/health`, a lease, PID or old working port proves nothing. Failed build/occupied strict port is not ready.

Read [verification surfaces](references/verification.md). Default to an owned disposable profile and fresh browser context; observing a human workspace does not authorize resets, terminal-close or cleanup. Never auto-connect real services or read credentials.

Report **target UUID/generation → surface/actual endpoint → exercised check → artifact path → unverified limits**. A browser backend roundtrip, browser pixels, native WebView JS, native pixels/chrome, and native storage are separate claims. Bare Vite is not backend integration; `screenshot_dom` is not pixels. Use **omniview-workspaces** for lifecycle recovery, not manual kills/adoption.
