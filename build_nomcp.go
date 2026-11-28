//go:build !mcp || ios || android

package main

// mcpBuild says whether Wails' own MCP server is compiled in (the -tags mcp development builds).
const mcpBuild = false
