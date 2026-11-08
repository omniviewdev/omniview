package devworkspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/stretchr/testify/require"
)

func TestLinkInspectionKeepsIndependentFailuresAndReadsCurrentTargets(t *testing.T) {
	t.Parallel()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	consumer := filepath.Join(root, "consumer")
	writeGraphFixture(t, filepath.Join(consumer, "package.json"), `{"name":"consumer","dependencies":{"@omniviewdev/runtime":"*"}}`)
	selected := filepath.Join(root, "selected")
	foreign := filepath.Join(root, "foreign")
	const manifest = `{"name":"@omniviewdev/runtime","version":"1.0.0","exports":{".":"./index.js","./api":"./index.js","./runtime":"./index.js"}}`
	for _, directory := range []string{selected, foreign} {
		writeGraphFixture(t, filepath.Join(directory, "package.json"), manifest)
		writeGraphFixture(t, filepath.Join(directory, "index.js"), "export const value = true;\n")
	}
	link := filepath.Join(consumer, "node_modules", "@omniviewdev", "runtime")
	require.NoError(t, os.MkdirAll(filepath.Dir(link), 0700))
	require.NoError(t, os.Symlink(selected, link))
	second := filepath.Join(root, "second-consumer")
	writeGraphFixture(t, filepath.Join(second, "package.json"), `{"name":"second-consumer","dependencies":{"@omniviewdev/runtime":"*"}}`)
	secondLink := filepath.Join(second, "node_modules", "@omniviewdev", "runtime")
	require.NoError(t, os.MkdirAll(filepath.Dir(secondLink), 0700))
	require.NoError(t, os.Symlink(foreign, secondLink))
	journal := &linkJournal{Root: root, Plan: linkPlan{
		Composition: &devcompose.Plan{},
		Consumers: []linkConsumer{
			{Path: consumer, Targets: map[string]string{"@omniviewdev/runtime": selected}},
			{Path: second, Targets: map[string]string{"@omniviewdev/runtime": foreign}},
		},
	}}
	check := func(foreignTarget bool) {
		t.Helper()
		report := inspectLinkPlan(context.Background(), journal)
		runtime := map[string]LinkResolution{}
		for _, resolution := range report.Resolutions {
			if resolution.Consumer == second {
				if resolution.Package == "@omniviewdev/runtime" {
					require.Equal(t, foreign, resolution.Resolved, "each consumer must retain its own resolution parent")
					require.Empty(t, resolution.Problem)
				}
				continue
			}
			if resolution.Package == "@omniviewdev/runtime" || filepath.Dir(resolution.Package) == "@omniviewdev/runtime" {
				runtime[resolution.Package] = resolution
			}
		}
		for _, name := range []string{"@omniviewdev/runtime", "@omniviewdev/runtime/api", "@omniviewdev/runtime/runtime"} {
			resolution, ok := runtime[name]
			require.True(t, ok, name)
			if foreignTarget {
				require.Equal(t, foreign, resolution.Resolved)
				require.Equal(t, "resolved package is not the selected feature package", resolution.Problem)
			} else {
				require.Equal(t, selected, resolution.Resolved)
				require.Empty(t, resolution.Problem)
			}
		}
		require.NotEmpty(t, runtime["@omniviewdev/runtime/models"].Problem, "a missing export must fail independently")
	}
	check(false)
	writeGraphFixture(t, filepath.Join(selected, "package.json"), strings.Replace(manifest, `"version":"1.0.0"`, `"version":42`, 1))
	malformed := inspectLinkPlan(context.Background(), journal)
	seen := map[string]bool{}
	for _, resolution := range malformed.Resolutions {
		if resolution.Package != "@omniviewdev/runtime" {
			continue
		}
		seen[resolution.Consumer] = true
		if resolution.Consumer == consumer {
			require.NotEmpty(t, resolution.Problem, "malformed target metadata must refuse its own resolution")
		} else {
			require.Empty(t, resolution.Problem, "malformed target metadata must not poison another consumer")
			require.Equal(t, foreign, resolution.Resolved)
		}
	}
	require.Equal(t, map[string]bool{consumer: true, second: true}, seen)
	writeGraphFixture(t, filepath.Join(selected, "package.json"), manifest)
	check(false)
	require.NoError(t, os.Remove(link))
	require.NoError(t, os.Symlink(foreign, link))
	check(true)
}

func TestLinkInspectionResolvesLargeConsumerCohort(t *testing.T) {
	t.Parallel()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	selected := filepath.Join(root, "selected")
	writeGraphFixture(t, filepath.Join(selected, "package.json"), `{"name":"@omniviewdev/runtime","version":"1.0.0","exports":{".":"./index.js","./api":"./index.js","./models":"./index.js","./runtime":"./index.js"}}`)
	writeGraphFixture(t, filepath.Join(selected, "index.js"), "export const value = true;\n")
	link := filepath.Join(root, "node_modules", "@omniviewdev", "runtime")
	require.NoError(t, os.MkdirAll(filepath.Dir(link), 0700))
	require.NoError(t, os.Symlink(selected, link))
	journal := &linkJournal{Root: root, Plan: linkPlan{Composition: &devcompose.Plan{}}}
	want := map[string]map[string]bool{}
	// Long shared ancestors exceed Linux's single-argument limit with fewer
	// independent consumer trees. Windows's smaller argument limit needs no
	// long-path fixture. Every consumer still resolves every public export.
	consumerRoot := root
	if runtime.GOOS != "windows" {
		for range 5 {
			consumerRoot = filepath.Join(consumerRoot, strings.Repeat("p", 100))
		}
	}
	payloadLowerBound := 0
	for index := range 64 {
		consumer := filepath.Join(consumerRoot, fmt.Sprintf("consumer-%03d", index))
		writeGraphFixture(t, filepath.Join(consumer, "package.json"), `{"name":"consumer","dependencies":{"@omniviewdev/runtime":"*"}}`)
		journal.Plan.Consumers = append(journal.Plan.Consumers, linkConsumer{Path: consumer, Targets: map[string]string{"@omniviewdev/runtime": selected}})
		want[consumer] = map[string]bool{
			"@omniviewdev/runtime": true, "@omniviewdev/runtime/api": true,
			"@omniviewdev/runtime/models": true, "@omniviewdev/runtime/runtime": true,
		}
		for specifier := range want[consumer] {
			payloadLowerBound += len(consumer) + len(specifier) + len("@omniviewdev/runtime")
		}
	}
	argumentLimit := 128 * 1024
	if runtime.GOOS == "windows" {
		argumentLimit = 32767
	}
	require.Greater(t, payloadLowerBound, argumentLimit, "the regression fixture must exceed a native argument limit")
	report := inspectLinkPlan(context.Background(), journal)
	got := map[string]map[string]bool{}
	for _, resolution := range report.Resolutions {
		if !want[resolution.Consumer][resolution.Package] {
			continue
		}
		require.Empty(t, resolution.Problem, "%s: %s", resolution.Consumer, resolution.Package)
		require.Equal(t, selected, resolution.Resolved)
		if got[resolution.Consumer] == nil {
			got[resolution.Consumer] = map[string]bool{}
		}
		got[resolution.Consumer][resolution.Package] = true
	}
	require.Equal(t, want, got, "every consumer must retain all public exports across a large inspection")
}
