package diagnostics

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// StartupReportEnv names a file the startup report is written to as JSON.
	// Used by scripts/perf/coldstart.sh.
	StartupReportEnv = "OMNIVIEW_STARTUP_REPORT"
	// StartupExitEnv makes the app quit as soon as the startup report is written.
	StartupExitEnv = "OMNIVIEW_STARTUP_EXIT"
)

// processStart is taken during package initialisation, before main runs.
var processStart = time.Now() //nolint:gochecknoglobals // process-wide timestamp

var startupOnce sync.Once //nolint:gochecknoglobals // report at most once per process

// ReportStartupReady is called once by the frontend when the shell is first
// interactive. marks carries frontend timings (milliseconds). The report is
// printed to stderr, and written to $OMNIVIEW_STARTUP_REPORT when set.
func (c *DiagnosticsClient) ReportStartupReady(marks map[string]float64) {
	startupOnce.Do(func() {
		readyAt := time.Now()
		report := map[string]any{
			"process_start_unix_ms": processStart.UnixMilli(),
			"backend_ready_unix_ms": readyAt.UnixMilli(),
			"process_to_ready_ms":   readyAt.Sub(processStart).Milliseconds(),
		}
		for k, v := range marks {
			report[k] = v
		}

		data, err := json.Marshal(report)
		if err != nil {
			return
		}
		fmt.Fprintf(os.Stderr, "startup.ready %s\n", data)

		if path := os.Getenv(StartupReportEnv); path != "" {
			if err := os.WriteFile(path, data, 0o644); err != nil { //nolint:gosec // perf report, not sensitive
				fmt.Fprintf(os.Stderr, "startup.ready: write %s: %v\n", path, err)
			}
		}

		if os.Getenv(StartupExitEnv) == "1" {
			if app := application.Get(); app != nil {
				go app.Quit()
			}
		}
	})
}
