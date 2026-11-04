---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": minor
---

Add durable, profile-local activities for asynchronous tasks, resource actions, and actionable alerts. Plugins publish typed progress, metrics, and canonical resource/action intents; the host owns execution and renders the same activity in compact lower-right notifications, the Notification Center, and the footer.

Progress updates preserve collapsed and hidden presentation state. Determinate bars reflect measured producer units with reduced-motion support. Cancellation remains distinct from observer detachment and remote rollback; unavailable actions are omitted rather than explained inline.

Release the integrated desktop/runtime/Vite-plugin cohort as 0.30.0 with Base UI 0.14.0 and plugin SDK v0.15.0. This preserves the newer cluster explorer and atomic shared plugin-preference changes already on main. Activity-enabled Kubernetes and Containers releases require IDE 0.30.0 or newer. The earlier npm-only 0.28.0 cohort was not a compatible desktop release; npm 0.29.0 predates the host activity integration.

Kubernetes rollout and other supported streaming actions report real task progress. Helm lifecycle progress and generic create/update tracking are not included in this release.
