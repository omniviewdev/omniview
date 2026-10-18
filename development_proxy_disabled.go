//go:build devcontrol && production

package main

// Wails' production asset handler serves embedded assets, not the dev proxy.
const developmentAssetProxyEnabled = false
