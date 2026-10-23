package main

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func handleViteFeedbackRead(args []string, out, diagnostics io.Writer) (bool, int) {
	if len(args) == 0 || args[0] != "vite-feedback-read" {
		return false, 0
	}
	if len(args) != 3 || args[1] != "--context" {
		fmt.Fprintln(diagnostics, "vite-feedback-read requires one explicit --context JSON argument")
		return true, 2
	}
	held, err := devworkspace.ReadViteFeedbackContext(args[2])
	if err != nil {
		fmt.Fprintln(diagnostics, "feedback authority refused:", err)
		return true, 4
	}
	if err := json.NewEncoder(out).Encode(struct {
		Held bool `json:"held"`
	}{Held: held}); err != nil {
		return true, 1
	}
	return true, 0
}
