# Status: CI3 (bound and retry the Playwright browser install)

- Goal: run 44667706073 ("Render benchmarks") hung 29 minutes in "Install Playwright Chromium" and died at the 30 m job limit. Every workflow step that runs `playwright install` now runs it under `timeout --kill-after=15 <N>`, once more on failure or timeout, and fails with an `::error::` the second time. `--with-deps` and the browser cache are unchanged.
- Worktree: `~/Repos/omniviewdev/worktrees/ci-browser-install-timeout`; branch `ci/browser-install-timeout`.

## Steps changed (step start line; the loop is the `run:` below it)

| Step | Limit per attempt | Normal install (three recent green runs) |
|---|---|---|
| `.github/workflows/app-profile.yml:135` Install Playwright Chromium | 300 s | 27 s, 24 s, 26 s (44672836836, 44672734111, 44671321555) |
| `.github/workflows/plugin-archive-smoke.yml:46` Install pinned browser | 300 s | 20 s, 19 s, 18 s (43109527157, 42956568258, 42954770900) |
| `.github/workflows/render-bench.yml:65` Install Playwright Chromium | 480 s | 61 s, 124 s, 279 s (44672836837, 44672734400, 44671321546) |
| `.github/workflows/ui-next-kit-probes.yml:100` Install the browsers (chromium, webkit) | 900 s | 525 s, 455 s, 32 s (44667706048, 44662271258, 44659457101) |
| `.github/workflows/ui-next-pods.yml:236` Install the browser | 480 s | 258 s, 137 s, 50 s (44672734019, 44672344731, 44670527914) |

The limits are not all 300 s: green installs reached 279 s (render), 258 s (pods) and 525 s (kit probes), so 300 s would fail good runs. Each limit is about 1.5x the slowest green install; two attempts still fit the job limit (render 30 m, pods 30 m, kit probes 55 m). `ci-image.yml` only runs `install-deps --dry-run` inside a container build and `e2e-runner.yml` restores a cache and installs through the e2e task; neither runs `playwright install` in a workflow step, so neither is changed.

## Log

- 2026-11-20: five steps changed; PR opened. `plugin-archive-smoke.yml` is a `workflow_call` workflow with no caller in this repository, so this PR's CI cannot run it.
- 2026-11-20: first full CI run: Kit probes failed. Attempt 1 hit its limit (cold apt deps, still downloading); the killed attempt left a root `apt-get` running, so attempt 2 died on the dpkg lock (run 44674842789). Fixed: the retry sets `DPkg::Lock::Timeout 600` so it waits for the lock; Kit probes limit 900 s. Retry path proven earlier on render-bench with a temporary first-attempt failure (run 44674379130, install step 21 s, attempt 2 succeeded); that commit was removed.
- 2026-11-20: final head, all changed workflows green (the cache was warm, installs short): Whole-app profile 39 s (run 44746976858), Render benchmarks 43 s (44746976892), Pods cluster check 33 s (44746976822), Kit probes 49 s (44746976937). `plugin-archive-smoke.yml` has no caller here and was not run; its change is the same loop.
