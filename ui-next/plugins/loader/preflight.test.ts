import { describe, expect, it } from 'vitest';
import { readDependencies, unservedImports } from './preflight';

// What a bundle states about itself before it runs: the dependency list of its first `System.register`. The samples are what Rollup writes for the
// `system` format (the plugin builds' output), minified and not, and what an old-shell bundle looks like to the new one.

const MINIFIED = 'System.register(["react/compiler-runtime","@omniviewdev/kit","react","react/jsx-runtime"],(function(h,N){"use strict";return{setters:[],execute:(function(){})}}));';
const READABLE = `System.register(['react', 'react/jsx-runtime', './chunk.js'], function (exports, module) {
  'use strict';
  return { setters: [], execute: function () {} };
});`;
const OLD_SHELL = 'System.register(["react","@omniviewdev/base-ui","@omniviewdev/runtime","./entry2.js"],(function(n,u){return{setters:[],execute:(function(){})}}));';

describe('the dependencies a bundle declares', () => {
  it('reads a minified registration', () => {
    expect(readDependencies(MINIFIED)).toEqual(['react/compiler-runtime', '@omniviewdev/kit', 'react', 'react/jsx-runtime']);
  });

  it('reads single quotes, spaces and a local chunk', () => {
    expect(readDependencies(READABLE)).toEqual(['react', 'react/jsx-runtime', './chunk.js']);
  });

  it('reads a registration that follows other code', () => {
    expect(readDependencies(`var __style = 1;\n${MINIFIED}`)).toEqual(['react/compiler-runtime', '@omniviewdev/kit', 'react', 'react/jsx-runtime']);
  });

  it('reads an empty list', () => {
    expect(readDependencies('System.register([],function(e){return{execute:function(){}}});')).toEqual([]);
  });

  it('reads the dependencies of a named registration', () => {
    expect(readDependencies('System.register("shared://react", ["a"], function(){});')).toEqual(['a']);
  });

  it('answers nothing for a text that registers nothing', () => {
    expect(readDependencies('console.log("hello")')).toBeUndefined();
  });
});

describe('the imports a host does not serve', () => {
  const served = ['react', 'react/jsx-runtime', '@omniviewdev/kit'];

  it('is empty when every name is served or a file of the plugin', () => {
    expect(unservedImports(READABLE, served)).toEqual([]);
  });

  it('names what an old-shell bundle needs and this host lacks, in order, and never a local chunk', () => {
    expect(unservedImports(OLD_SHELL, served)).toEqual(['@omniviewdev/base-ui', '@omniviewdev/runtime']);
  });

  it('leaves a text that registers nothing to the loader', () => {
    expect(unservedImports('throw new Error("not a bundle")', served)).toEqual([]);
  });

  it('does not take an absolute path or a URL for a name', () => {
    expect(unservedImports('System.register(["/_/plugins/x/assets/a.js","http://host/b.js","shared://react"],function(){});', served)).toEqual([]);
  });
});
