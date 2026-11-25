---
'@omniviewdev/runtime': patch
---

`useConnectionReadiness` keeps the class of a connection start that failed with an error, whichever the page hears first: the start's own rejection or the host's `connection/status` event.

The host now tells every window that a start failed, with a `FAILED` event that carries `error`, the same public error the rejection carries. The listener answered every event with the generic snapshot (`error`, "The connection is not ready."), and an event that came before the rejection made the hook drop the rejection (the class, `unauthorized`, `forbidden` or `not-found`, and its sentence), as one that came after it replaced them. A `FAILED` event with an `error` is now read like the rejection (`parseAppError`, so a payload that is not the host's error shows nothing of itself), the phase and the message are the same in both orders, and a window that was only checking when the host started the connection shows the class too. An event without an `error` (a status the provider returned) is read as before.

On the real host the two orders both happen: in Chromium the event was heard before the answer's body in 40 of 40 failed starts, in WebKit in 20 of 40.
