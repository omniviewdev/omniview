import { PluginValidationError } from './errors';
import type { ValidatedExports, SidebarComponent, DrawerFactory } from './types';

/**
 * Validate the format of a resource key.
 * Valid format: GROUP::VERSION::KIND (exactly 3 parts separated by ::).
 * Each part must be non-empty and not contain spaces.
 *
 * @throws PluginValidationError if the key is malformed
 */
export function validateResourceKeyFormat(
  key: string,
  kind: 'sidebar' | 'drawer',
): void {
  if (!key || typeof key !== 'string') {
    throw new PluginValidationError(
      `${kind} key is empty or not a string`,
      { errors: [`${kind} key is empty or not a string`] },
    );
  }

  // Must not contain spaces
  if (/\s/.test(key)) {
    throw new PluginValidationError(
      `${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND (no spaces allowed)`,
      { errors: [`${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND`] },
    );
  }

  const parts = key.split('::');
  if (parts.length !== 3) {
    throw new PluginValidationError(
      `${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND`,
      { errors: [`${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND`] },
    );
  }

  // Each part must be non-empty
  for (const part of parts) {
    if (!part) {
      throw new PluginValidationError(
        `${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND (empty segment)`,
        { errors: [`${kind} key '${key}' is malformed, expected GROUP::VERSION::KIND`] },
      );
    }
  }
}

/**
 * Validate raw plugin module exports and return a typed ValidatedExports.
 *
 * This function does not register anything — it only validates the shape.
 *
 * @throws PluginValidationError if exports are invalid
 */
export function validatePluginExports(exports: unknown): ValidatedExports {
  const errors: string[] = [];

  // --- Basic shape ---
  if (exports == null || typeof exports !== 'object') {
    throw new PluginValidationError(
      'Plugin exports are null or not an object',
      { errors: ['exports are null or not an object'] },
    );
  }

  const exp = exports as Record<string, unknown>;

  // --- plugin export ---
  if (!('plugin' in exp) || exp.plugin == null) {
    throw new PluginValidationError(
      "Missing required 'plugin' export",
      { errors: ["Missing required 'plugin' export"] },
    );
  }

  const plugin = exp.plugin;

  if (typeof plugin !== 'object' || Array.isArray(plugin)) {
    throw new PluginValidationError(
      "'plugin' must be an object (PluginWindow instance)",
      { errors: ["'plugin' must be an object"] },
    );
  }

  const pw = plugin as Record<string, unknown>;

  // --- Routes validation ---
  // Check _routes directly to avoid triggering PluginWindow's Routes getter
  // which throws when no routes/root are set.
  if ('_routes' in pw) {
    const routes = pw._routes;
    if (routes !== undefined && routes !== null && !Array.isArray(routes)) {
      throw new PluginValidationError(
        "'plugin.Routes' must be an array",
        { errors: ["'plugin.Routes' must be an array"] },
      );
    }
  }
  // Also handle plain objects passed with a Routes property (non-PluginWindow)
  if (!('_routes' in pw) && 'Routes' in pw) {
    // For plain objects, Routes won't be a getter that throws
    const routes = pw.Routes;
    if (routes !== undefined && routes !== null && !Array.isArray(routes)) {
      throw new PluginValidationError(
        "'plugin.Routes' must be an array",
        { errors: ["'plugin.Routes' must be an array"] },
      );
    }
  }

  // --- extensionRegistrations ---
  let extensionRegistrations: unknown[] = [];
  if ('extensionRegistrations' in exp && exp.extensionRegistrations !== undefined) {
    if (!Array.isArray(exp.extensionRegistrations)) {
      throw new PluginValidationError(
        "'extensionRegistrations' must be an array",
        { errors: ["'extensionRegistrations' must be an array"] },
      );
    }
    extensionRegistrations = exp.extensionRegistrations;
  }

  // --- sidebars ---
  let sidebars: Record<string, SidebarComponent> = {};
  if ('sidebars' in exp && exp.sidebars !== undefined && exp.sidebars !== null) {
    if (typeof exp.sidebars !== 'object' || Array.isArray(exp.sidebars)) {
      throw new PluginValidationError(
        "'sidebars' must be an object",
        { errors: ["'sidebars' must be an object"] },
      );
    }
    const sidebarMap = exp.sidebars as Record<string, unknown>;
    for (const [key, value] of Object.entries(sidebarMap)) {
      validateResourceKeyFormat(key, 'sidebar');
      if (typeof value !== 'function') {
        errors.push(`sidebar value for key '${key}' must be a component (function), got ${typeof value}`);
      }
    }
    if (errors.length > 0) {
      throw new PluginValidationError(
        `Sidebar validation failed: ${errors.join('; ')}`,
        { errors },
      );
    }
    sidebars = sidebarMap as Record<string, SidebarComponent>;
  }

  // --- drawers ---
  let drawers: Record<string, DrawerFactory> = {};
  if ('drawers' in exp && exp.drawers !== undefined && exp.drawers !== null) {
    if (typeof exp.drawers !== 'object' || Array.isArray(exp.drawers)) {
      throw new PluginValidationError(
        "'drawers' must be an object",
        { errors: ["'drawers' must be an object"] },
      );
    }
    const drawerMap = exp.drawers as Record<string, unknown>;
    for (const [key, value] of Object.entries(drawerMap)) {
      validateResourceKeyFormat(key, 'drawer');
      if (typeof value !== 'function') {
        errors.push(`drawer value for key '${key}' must be a factory function, got ${typeof value}`);
      }
    }
    if (errors.length > 0) {
      throw new PluginValidationError(
        `Drawer validation failed: ${errors.join('; ')}`,
        { errors },
      );
    }
    drawers = drawerMap as Record<string, DrawerFactory>;
  }

  // --- Extension point definition validation ---
  const rawExtensions = pw._extensions ?? pw.extensions;
  if (rawExtensions != null && !Array.isArray(rawExtensions)) {
    throw new PluginValidationError(
      "'_extensions' or 'extensions' must be an array if present",
      { errors: ["'_extensions' or 'extensions' must be an array if present"] },
    );
  }
  const extensions = (rawExtensions ?? []) as unknown[];
  if (extensions.length > 0) {
    const seenIds = new Set<string>();
    for (const ep of extensions) {
      if (ep == null || typeof ep !== 'object') {
        throw new PluginValidationError(
          'Extension point definition must be an object',
          { errors: ['Extension point definition must be an object'] },
        );
      }
      const epObj = ep as Record<string, unknown>;
      if (!epObj.id || typeof epObj.id !== 'string') {
        throw new PluginValidationError(
          'Extension point definition must have a string "id" field',
          { errors: ['Extension point definition must have a string "id" field'] },
        );
      }
      if (seenIds.has(epObj.id)) {
        throw new PluginValidationError(
          `Duplicate extension point ID '${epObj.id}' within the same plugin`,
          { errors: [`Duplicate extension point ID '${epObj.id}'`] },
        );
      }
      seenIds.add(epObj.id);
    }
  }

  // --- dependencies (optional, advisory) ---
  if ('dependencies' in exp && exp.dependencies !== undefined && exp.dependencies !== null) {
    if (typeof exp.dependencies !== 'object' || Array.isArray(exp.dependencies)) {
      throw new PluginValidationError(
        "'dependencies' must be an object",
        { errors: ["'dependencies' must be an object"] },
      );
    }
    const deps = exp.dependencies as Record<string, unknown>;

    if ('plugins' in deps && deps.plugins !== undefined) {
      if (!Array.isArray(deps.plugins)) {
        throw new PluginValidationError(
          "'dependencies.plugins' must be an array",
          { errors: ["'dependencies.plugins' must be an array"] },
        );
      }
      for (const item of deps.plugins) {
        if (typeof item !== 'string') {
          throw new PluginValidationError(
            "'dependencies.plugins' must contain only strings",
            { errors: ["'dependencies.plugins' must contain only strings"] },
          );
        }
      }
    }

    if ('extensionPoints' in deps && deps.extensionPoints !== undefined) {
      if (!Array.isArray(deps.extensionPoints)) {
        throw new PluginValidationError(
          "'dependencies.extensionPoints' must be an array",
          { errors: ["'dependencies.extensionPoints' must be an array"] },
        );
      }
      for (const item of deps.extensionPoints) {
        if (typeof item !== 'string') {
          throw new PluginValidationError(
            "'dependencies.extensionPoints' must contain only strings",
            { errors: ["'dependencies.extensionPoints' must contain only strings"] },
          );
        }
      }
    }
  }

  return {
    plugin: plugin as ValidatedExports['plugin'],
    extensionRegistrations: extensionRegistrations as ValidatedExports['extensionRegistrations'],
    sidebars,
    drawers,
  };
}
