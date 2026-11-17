import type { IconName } from '../Icon';

/**
 * The seven roles of the design (13 SR1), the one finite table every state is drawn from. A role fixes the glyph: one glyph carries one
 * meaning and one meaning has one glyph, in every plugin and on the host. A plugin maps each native state word to a role in its own
 * checked table; the word keeps its spelling, the role chooses the glyph.
 *
 * - `healthy`: a good verdict or a good outcome (ready, bound, passed, connected, completed). Never a bare yes, nor a thing that is only running.
 * - `running`: up and doing its work, a lifecycle fact that asserts no verdict. Never healthy.
 * - `progress`: a change is in motion (the loader) or waiting to start (the clock). Pending is progress, not attention.
 * - `attention`: needs a look but is not broken (degraded, partial, stale, a risky setting).
 * - `error`: it failed or cannot work (failed, denied, crashed). Never a missing value.
 * - `stopped`: stopped, disabled or disconnected; nothing is wrong. Never a bare no, a missing value or a failure.
 * - `info`: an informational message or an available update. Never a state a thing can be in.
 */
export type StatusRole = 'healthy' | 'running' | 'progress' | 'attention' | 'error' | 'stopped' | 'info';

export const STATUS_ROLES: readonly StatusRole[] = ['healthy', 'running', 'progress', 'attention', 'error', 'stopped', 'info'];

/** The glyph of each role. The four status glyphs and the play glyph pin their own paints (the registry resolves them from theme roles). */
export const STATUS_GLYPHS: Readonly<Record<StatusRole, IconName>> = {
  healthy: 'status-success',
  running: 'play',
  progress: 'loader-circle',
  attention: 'status-warning',
  error: 'status-error',
  stopped: 'circle-minus',
  info: 'status-info',
};

/** Progress that waits to start (13 SR1: Pending is a clock) is not the loader of work under way. */
export const QUEUED_GLYPH: IconName = 'clock';
