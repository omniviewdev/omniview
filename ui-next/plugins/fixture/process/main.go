// The process behind the seam's fixture plugin when the check wants one (PU1, ui-next/plugins/e2e/seam.check.mjs, scenario n): a plugin backend that does nothing but be a process the host owns, so
// that the check can end it from outside, by the pid the host reports, and see what the window does when the host says the plugin crashed. It registers no capability of its own: the SDK serves the
// lifecycle and settings services every plugin has, which is all the host needs to load it and to ask it whether it is well.
package main

import "github.com/omniviewdev/plugin-sdk/pkg/sdk"

// pluginID is the fixture plugin this process belongs to: the SDK refuses to start when it is not the id in the plugin.yaml next to the binary.
const pluginID = "fixture-a-ok"

func main() {
	sdk.NewPlugin(sdk.PluginOpts{ID: pluginID, Settings: nil, Debug: false}).Serve()
}
