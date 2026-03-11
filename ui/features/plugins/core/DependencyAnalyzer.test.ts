import { describe, it, expect } from 'vitest';
import { DependencyAnalyzer } from './DependencyAnalyzer';

describe('DependencyAnalyzer', () => {
  describe('addPlugin / removePlugin', () => {
    it('adds a plugin with dependencies', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('plugin-a', { plugins: ['plugin-b'], extensionPoints: ['ep/1'] });
      const graph = analyzer.getGraph();
      expect(graph.nodes).toContain('plugin-a');
      expect(graph.edges).toContainEqual(['plugin-a', 'plugin-b']);
    });

    it('removes a plugin and its edges', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('plugin-a', { plugins: ['plugin-b'], extensionPoints: [] });
      analyzer.removePlugin('plugin-a');
      const graph = analyzer.getGraph();
      expect(graph.nodes).not.toContain('plugin-a');
      expect(graph.edges).toHaveLength(0);
    });

    it('handles plugin with no dependencies', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('plugin-a', { plugins: [], extensionPoints: [] });
      const graph = analyzer.getGraph();
      expect(graph.nodes).toContain('plugin-a');
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe('detectCycles', () => {
    it('returns empty for acyclic graph', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: ['c'], extensionPoints: [] });
      analyzer.addPlugin('c', { plugins: [], extensionPoints: [] });
      expect(analyzer.detectCycles()).toEqual([]);
    });

    it('detects a simple 2-node cycle as one group', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: ['a'], extensionPoints: [] });
      const cycles = analyzer.detectCycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b']));
      expect(cycles[0]).toHaveLength(2);
    });

    it('detects a 3-node cycle as one group', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: ['c'], extensionPoints: [] });
      analyzer.addPlugin('c', { plugins: ['a'], extensionPoints: [] });
      const cycles = analyzer.detectCycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });

    it('detects two independent cycles as separate groups', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: ['a'], extensionPoints: [] });
      analyzer.addPlugin('x', { plugins: ['y'], extensionPoints: [] });
      analyzer.addPlugin('y', { plugins: ['x'], extensionPoints: [] });
      const cycles = analyzer.detectCycles();
      expect(cycles).toHaveLength(2);
      const allNodes = cycles.flat().sort();
      expect(allNodes).toEqual(['a', 'b', 'x', 'y']);
    });

    it('handles self-dependency', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['a'], extensionPoints: [] });
      const cycles = analyzer.detectCycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toEqual(['a']);
    });

    it('excludes acyclic nodes from cycle groups', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: ['a'], extensionPoints: [] });
      analyzer.addPlugin('c', { plugins: ['a'], extensionPoints: [] }); // c depends on a but not cyclic
      const cycles = analyzer.detectCycles();
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b']));
      expect(cycles[0]).not.toContain('c');
    });
  });

  describe('checkMissingDependencies', () => {
    it('returns missing plugins', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b', 'c'], extensionPoints: [] });
      const loadedPlugins = new Set(['a']);
      const registeredEPs = new Set<string>();
      const warnings = analyzer.checkMissingDependencies('a', loadedPlugins, registeredEPs);
      expect(warnings).toContain('Plugin "a" declares dependency on plugin "b" which is not loaded');
      expect(warnings).toContain('Plugin "a" declares dependency on plugin "c" which is not loaded');
    });

    it('returns missing extension points', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: [], extensionPoints: ['ep/1', 'ep/2'] });
      const loadedPlugins = new Set(['a']);
      const registeredEPs = new Set(['ep/1']);
      const warnings = analyzer.checkMissingDependencies('a', loadedPlugins, registeredEPs);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ep/2');
    });

    it('returns empty when all dependencies are met', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b'], extensionPoints: ['ep/1'] });
      const loadedPlugins = new Set(['a', 'b']);
      const registeredEPs = new Set(['ep/1']);
      const warnings = analyzer.checkMissingDependencies('a', loadedPlugins, registeredEPs);
      expect(warnings).toHaveLength(0);
    });

    it('returns empty for plugin with no declared dependencies', () => {
      const analyzer = new DependencyAnalyzer();
      const warnings = analyzer.checkMissingDependencies('a', new Set(['a']), new Set());
      expect(warnings).toHaveLength(0);
    });
  });

  describe('getGraph', () => {
    it('returns all nodes and edges', () => {
      const analyzer = new DependencyAnalyzer();
      analyzer.addPlugin('a', { plugins: ['b', 'c'], extensionPoints: [] });
      analyzer.addPlugin('b', { plugins: [], extensionPoints: [] });
      const graph = analyzer.getGraph();
      expect(graph.nodes).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(graph.edges).toEqual(expect.arrayContaining([['a', 'b'], ['a', 'c']]));
    });
  });
});
