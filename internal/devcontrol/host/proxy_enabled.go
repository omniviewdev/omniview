//go:build devcontrol && !production

package host

// Wails' development asset handler honors FRONTEND_DEVSERVER_URL.
const developmentAssetProxyEnabled = true
