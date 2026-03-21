/**
 * Types for the plugin process log viewer.
 * LogEntry is re-exported from the Wails-generated binding so there
 * is a single source of truth.
 */
import type { PluginLogEntry as PluginLogEntryModel } from '@omniviewdev/runtime/models';

/** A single line of plugin process output. */
export type PluginLogEntry = PluginLogEntryModel;
