/**
 * Base error class for all plugin service errors.
 */
export class PluginServiceError extends Error {
  readonly pluginId?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts?: { pluginId?: string; cause?: unknown },
  ) {
    super(message, { cause: opts?.cause });
    this.name = 'PluginServiceError';
    this.pluginId = opts?.pluginId;
    // Ensure cause is accessible even in environments that don't support it natively
    if (opts?.cause !== undefined) {
      this.cause = opts.cause;
    }
  }
}

/**
 * Thrown when plugin module exports fail validation.
 */
export class PluginValidationError extends PluginServiceError {
  readonly errors: string[];

  constructor(
    message: string,
    opts?: { pluginId?: string; errors?: string[]; cause?: unknown },
  ) {
    super(message, { pluginId: opts?.pluginId, cause: opts?.cause });
    this.name = 'PluginValidationError';
    this.errors = opts?.errors ?? [];
  }
}

/**
 * Thrown when a plugin module import fails.
 */
export class PluginImportError extends PluginServiceError {
  readonly url?: string;

  constructor(
    message: string,
    opts?: { pluginId?: string; url?: string; cause?: unknown },
  ) {
    super(message, { pluginId: opts?.pluginId, cause: opts?.cause });
    this.name = 'PluginImportError';
    this.url = opts?.url;
  }
}

/**
 * Thrown when a plugin module import exceeds the configured timeout.
 */
export class PluginTimeoutError extends PluginServiceError {
  readonly timeoutMs: number;

  constructor(
    message: string,
    opts: { pluginId: string; timeoutMs: number; cause?: unknown },
  ) {
    super(message, { pluginId: opts.pluginId, cause: opts.cause });
    this.name = 'PluginTimeoutError';
    this.timeoutMs = opts.timeoutMs;
  }
}

/**
 * Thrown when a plugin contribution targets a non-existent extension point.
 */
export class MissingExtensionPointError extends PluginServiceError {
  readonly extensionPointId: string;

  constructor(
    message: string,
    opts: { pluginId: string; extensionPointId: string; cause?: unknown },
  ) {
    super(message, { pluginId: opts.pluginId, cause: opts.cause });
    this.name = 'MissingExtensionPointError';
    this.extensionPointId = opts.extensionPointId;
  }
}

/**
 * Thrown when a contribution with the same ID is already registered
 * in the target extension point.
 */
export class DuplicateContributionError extends PluginServiceError {
  readonly extensionPointId: string;
  readonly contributionId: string;

  constructor(
    message: string,
    opts: { pluginId?: string; extensionPointId: string; contributionId: string; cause?: unknown },
  ) {
    super(message, { pluginId: opts.pluginId, cause: opts.cause });
    this.name = 'DuplicateContributionError';
    this.extensionPointId = opts.extensionPointId;
    this.contributionId = opts.contributionId;
  }
}

/**
 * Thrown when an extension point ID is already registered by another owner.
 */
export class DuplicateExtensionPointError extends PluginServiceError {
  readonly extensionPointId: string;
  readonly ownerPluginId?: string;

  constructor(
    message: string,
    opts: {
      pluginId?: string;
      extensionPointId: string;
      ownerPluginId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { pluginId: opts.pluginId, cause: opts.cause });
    this.name = 'DuplicateExtensionPointError';
    this.extensionPointId = opts.extensionPointId;
    this.ownerPluginId = opts.ownerPluginId;
  }
}
