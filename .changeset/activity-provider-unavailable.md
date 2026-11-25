---
'@omniviewdev/runtime': minor
---

`useActivities()` now says why the provider cannot observe the host's activity service: `unavailable`, the sentence of a subscription or a heartbeat that failed and that nothing has made good since. Nothing else sets it, so a failed `notify`, a failed `openDetails` and the host's `activity/observation-error` event no longer read as a service that is down.

`error` stays what the toast and the Notification Center say, the first failure the provider holds (the observation-error event, then `unavailable`, then a failed `notify`, then a failed `openDetails`), and it now recovers: each failure goes when its own source recovers and no other recovery takes it away. A heartbeat that gets through or a subscription that succeeds clears the event and `unavailable`; the next `notify` or `openDetails` that succeeds clears its own failure only. An event that came while a heartbeat or a subscription was in flight is not cleared by it, since that one began before the event.

A heartbeat that gets through while the subscription is down now makes the subscription again, as a failed heartbeat always did, so a provider that no longer says it is unavailable is observing. Before, a subscription that failed while the heartbeat kept passing was never made again.
