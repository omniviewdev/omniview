// Tuning for source views. Internal to the runtime: this module is not part of the package's public exports.

/** Minimum time between listener deliveries for one source view. */
export const MIN_DELIVERY_INTERVAL_MS = 100;

/** How long a collection's source view stays open after its last observer leaves, so a quick return reuses it. */
export const VIEW_LINGER_MS = 60_000;

/** The most released views kept open at once. Past it, the view released longest ago closes at once. */
export const MAX_LINGERING_VIEWS = 4;
