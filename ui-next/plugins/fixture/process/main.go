// The process behind the seam's fixture plugin when the check wants one (PU1, PU2, ui-next/plugins/e2e/seam.check.mjs, scenarios n and p): a plugin backend that does nothing but be a process the host owns, so
// that the check can end it from outside, by the pid the host reports, and see what the window does when the host says the plugin crashed, and so that the check can make its next start fail and see what the window does
// when the host says a load failed. It registers no capability of its own: the SDK serves the lifecycle and settings services every plugin has, which is all the host needs to load it and to ask it whether it is well.
package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

// pluginID is the fixture plugin this process belongs to: the SDK refuses to start when it is not the id in the plugin.yaml next to the binary.
const pluginID = "fixture-a-ok"

// startModeFile is the file the check writes in the plugin's own directory (next to bin/) to say how the next start of this process goes, and removes to let it start. "exit" ends the process at once, before it says it is
// ready, which the host sees as a plugin that did not start; "hang" keeps it alive and silent, which the host sees as a plugin that did not answer within its start timeout. No file, or another word, is the plugin as it always was.
const startModeFile = "start-mode"

// hangFor is how long a process that was told to hang stays: far longer than the loader's start timeout (15 s) and bounded, so that a process the host forgot to kill ends by itself.
const hangFor = 2 * time.Minute

func main() {
	switch startMode() {
	case "exit":
		os.Exit(1)
	case "hang":
		time.Sleep(hangFor)
		os.Exit(1)
	}

	sdk.NewPlugin(sdk.PluginOpts{ID: pluginID, Settings: nil, Debug: false}).Serve()
}

// startMode is what the file next to bin/ says, "" when there is none.
func startMode() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}

	text, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "..", startModeFile))
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(text))
}
