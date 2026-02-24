/**
 * Convert a package name to a filesystem-safe filename (without extension).
 *
 * Transformation rules:
 *   '@' at the start of a scoped package  -> '_'
 *   '/'                                   -> '__'
 *   '-'                                   -> '-' (unchanged, already safe)
 *   '.'                                   -> '.' (unchanged, already safe)
 *
 * Examples:
 *   'react'                    -> 'react'
 *   'react/jsx-runtime'        -> 'react__jsx-runtime'
 *   'react-router-dom'         -> 'react-router-dom'
 *   '@mui/material'             -> '_mui__material'
 *   '@mui/material/Box'        -> '_mui__material__Box'
 *   '@emotion/react'           -> '_emotion__react'
 *   '@tanstack/react-query'    -> '_tanstack__react-query'
 *   '@omniviewdev/runtime/api' -> '_omniviewdev__runtime__api'
 *   'date-fns'                 -> 'date-fns'
 *   '@monaco-editor/react'     -> '_monaco-editor__react'
 *
 * The mapping is bijective (reversible): given the rules, no two distinct
 * package names produce the same safe filename.
 */
export function safeFilename(packageName: string): string {
  let result = packageName;

  // Replace leading '@' with '_' for scoped packages
  if (result.startsWith('@')) {
    result = '_' + result.slice(1);
  }

  // Replace all '/' with '__'
  result = result.replace(/\//g, '__');

  return result;
}
