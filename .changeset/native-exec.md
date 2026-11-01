---
"@omniviewdev/runtime": minor
---

Add `useNativeExec({ pluginID?, resourceKey })` with platform-and-handler capability discovery, pending state, duplicate-click protection, and explicit boolean launch outcomes. Export typed `NativeExecInput` and `UseNativeExecResult`, a safely encoded `ExecClient.OpenNativeSession`, and `ExecClient.GetNativeTerminalSupport`. Native launch failures use standard error feedback without creating integrated tabs or falling back to built-in Exec.
