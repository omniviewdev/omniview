---
"@omniviewdev/runtime": patch
---

Keep a collection's source view open for 60 seconds after its last observer leaves (at most four at a time) and render a returning `useResources({ collection: true })` from the snapshot it already holds, so switching back to a recently viewed resource list no longer reopens the view and streams the collection again. Views of a replaced connection generation, failed opens, and views whose source failed or closed are never kept or reused.

Deliver source view updates to subscribers at most once every 100 ms after the first one, and reuse a resolved resource target within its connection generation for five minutes.

Stop resetting the table metric demand timer on every row mount and unmount.
