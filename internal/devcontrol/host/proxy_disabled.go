//go:build devcontrol && production

package host

// Wails' production asset handler serves embedded assets, not the dev proxy.
const developmentAssetProxyEnabled = false
