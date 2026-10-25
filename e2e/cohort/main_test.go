//go:build e2eapplication

package main

import (
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestApplicationCohortRequiresAllActualSelectedUIResolutions(t *testing.T) {
	paths := devworkspace.WorkspacePaths{Repositories: map[string]string{"omniview": "/private/host", "ui": "/private/selected-ui"}}
	var report devworkspace.LinkReport
	for _, name := range []string{"base-ui", "ai-ui", "editors"} {
		directory := filepath.Join(paths.Repositories["ui"], "packages", name)
		report.Resolutions = append(report.Resolutions, devworkspace.LinkResolution{Consumer: paths.Repositories["omniview"], Package: "@omniviewdev/" + name, Expected: directory, Resolved: directory})
	}
	if err := validateApplicationUIResolutions(paths, report); err != nil {
		t.Fatal(err)
	}
	report.Resolutions[1].Resolved = "/published/ai-ui"
	if err := validateApplicationUIResolutions(paths, report); err == nil {
		t.Fatal("published UI satisfied selected-source admission")
	}
	report.Resolutions = report.Resolutions[:1]
	if err := validateApplicationUIResolutions(paths, report); err == nil {
		t.Fatal("partial selected UI admission was accepted")
	}
}
