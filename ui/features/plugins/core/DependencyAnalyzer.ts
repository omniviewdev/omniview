import type { DeclaredDependencies, DependencyGraph } from './types';

interface PluginDependencyEntry {
  readonly plugins: readonly string[];
  readonly extensionPoints: readonly string[];
}

export class DependencyAnalyzer {
  private readonly entries = new Map<string, PluginDependencyEntry>();

  addPlugin(pluginId: string, deps: DeclaredDependencies): void {
    this.entries.set(pluginId, {
      plugins: [...deps.plugins],
      extensionPoints: [...deps.extensionPoints],
    });
  }

  removePlugin(pluginId: string): void {
    this.entries.delete(pluginId);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Detects cycles using Tarjan's SCC algorithm.
   * Returns an array of cycle groups — each group is a strongly connected component
   * with more than one node (or a self-loop). Acyclic nodes are excluded.
   * All operations are advisory — they never block loading.
   */
  detectCycles(): string[][] {
    // Build adjacency list (only plugin→plugin edges matter for cycles)
    const adj = new Map<string, string[]>();
    for (const [pluginId, entry] of this.entries) {
      if (!adj.has(pluginId)) adj.set(pluginId, []);
      for (const dep of entry.plugins) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(pluginId)!.push(dep);
      }
    }

    // Tarjan's SCC
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const strongconnect = (v: string): void => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const w of adj.get(v) ?? []) {
        if (!indices.has(w)) {
          strongconnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const node of adj.keys()) {
      if (!indices.has(node)) {
        strongconnect(node);
      }
    }

    // Filter to only SCCs that represent actual cycles:
    // - SCCs with 2+ nodes are always cycles
    // - SCCs with 1 node are cycles only if there's a self-edge
    return sccs.filter((scc) => {
      if (scc.length > 1) return true;
      const node = scc[0];
      return (adj.get(node) ?? []).includes(node);
    });
  }

  /**
   * Checks whether all declared dependencies for a plugin are currently available.
   * Returns a list of human-readable warning strings for anything missing.
   * Advisory only — does not prevent loading.
   */
  checkMissingDependencies(
    pluginId: string,
    loadedPlugins: ReadonlySet<string>,
    registeredExtensionPoints: ReadonlySet<string>,
  ): string[] {
    const entry = this.entries.get(pluginId);
    if (!entry) return [];

    const warnings: string[] = [];

    for (const dep of entry.plugins) {
      if (!loadedPlugins.has(dep)) {
        warnings.push(
          `Plugin "${pluginId}" declares dependency on plugin "${dep}" which is not loaded`,
        );
      }
    }

    for (const ep of entry.extensionPoints) {
      if (!registeredExtensionPoints.has(ep)) {
        warnings.push(
          `Plugin "${pluginId}" declares dependency on extension point "${ep}" which is not registered`,
        );
      }
    }

    return warnings;
  }

  /**
   * Returns a snapshot of the full dependency graph: all known nodes and directed edges.
   * An edge [A, B] means plugin A declares a dependency on B (plugin or extension point).
   */
  getGraph(): DependencyGraph {
    const nodes = new Set<string>();
    const edges: [string, string][] = [];

    for (const [pluginId, entry] of this.entries) {
      nodes.add(pluginId);
      for (const dep of entry.plugins) {
        nodes.add(dep);
        edges.push([pluginId, dep]);
      }
      for (const ep of entry.extensionPoints) {
        nodes.add(ep);
        edges.push([pluginId, ep]);
      }
    }

    return { nodes: [...nodes], edges };
  }
}
