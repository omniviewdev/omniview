package devworkspace

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestLinkedPeerContractsDiagnoseSelectedSourceCohorts(t *testing.T) {
	for _, test := range []struct {
		name          string
		query         string
		vite          string
		conflict      bool
		queryConflict bool
	}{
		{"reported installed pins as exact manifests", "5.90.21", "5.4.21", true, true},
		{"reported default source manifests", "^5.76.1", "^5.2.0", true, false},
		{"matching manifest cohort", "5.105.0", "7.3.7", false, false},
		{"compatible newer pins", "5.106.0", "7.4.0", false, false},
		{"overlapping ranges need native resolution", "^5.90.21", "^7.0.0", false, false},
		{"unsupported ranges need native resolution", "workspace:*", ">=7", false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			plugin := filepath.Join(root, "kubernetes/ui")
			runtime := filepath.Join(root, "omniview/packages/runtime")
			vitePlugin := filepath.Join(root, "omniview/packages/vite-plugin")
			writeGraphFixture(t, filepath.Join(plugin, "package.json"), `{"dependencies":{"@omniviewdev/runtime":"0.8.2","@tanstack/react-query":"`+test.query+`"},"devDependencies":{"@omniviewdev/vite-plugin":"0.8.2","vite":"`+test.vite+`"}}`)
			writeGraphFixture(t, filepath.Join(runtime, "package.json"), `{"peerDependencies":{"@tanstack/react-query":"^5.105.0"}}`)
			writeGraphFixture(t, filepath.Join(vitePlugin, "package.json"), `{"peerDependencies":{"vite":"^7.3.7"}}`)
			plan := linkPlan{Consumers: []linkConsumer{{Path: plugin, Targets: map[string]string{"@omniviewdev/runtime": runtime, "@omniviewdev/vite-plugin": vitePlugin}}}}
			w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root}}
			plan.Composition = &devcompose.Plan{Files: []devcompose.File{{Path: filepath.Join(root, "pnpm-workspace.yaml"), Data: []byte("overrides:\n  '@types/react': 19.3.0\n")}}}
			err := validateLinkedPeerContracts(w, plan)
			if !test.conflict {
				if err != nil {
					t.Fatalf("valid or unresolved cohort rejected: %v", err)
				}
				return
			}
			var failure *devcontract.Error
			if !errors.As(err, &failure) || failure.Code != "peer_contract_mismatch" {
				t.Fatalf("expected actionable peer conflict, got %v", err)
			}
			if got := strings.Contains(err.Error(), "@tanstack/react-query"); got != test.queryConflict {
				t.Errorf("query conflict: got %v, want %v: %v", got, test.queryConflict, err)
			}
			wantDetails := []string{"kubernetes/ui/package.json", "omniview/packages/vite-plugin/package.json", "vite", test.vite, "^7.3.7"}
			if test.queryConflict {
				wantDetails = append(wantDetails, "omniview/packages/runtime/package.json", test.query, "^5.105.0")
			}
			for _, want := range wantDetails {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("diagnostic missing %q: %v", want, err)
				}
			}
		})
	}
}

func TestLinkedPeerContractsUseDirectProviderContexts(t *testing.T) {
	root := t.TempDir()
	consumer := filepath.Join(root, "plugin")
	first := filepath.Join(root, "host/first")
	second := filepath.Join(root, "host/second")
	unused := filepath.Join(root, "host/unused")
	writeGraphFixture(t, filepath.Join(consumer, "package.json"), `{"dependencies":{"first":"1.0.0","react":"19.0.0"}}`)
	writeGraphFixture(t, filepath.Join(first, "package.json"), `{"dependencies":{"second":"1.0.0","react":"20.0.0"}}`)
	writeGraphFixture(t, filepath.Join(second, "package.json"), `{"dependencies":{"first":"1.0.0"},"peerDependencies":{"react":"^20.0.0"}}`)
	// An unused target must not even be read.
	targets := map[string]string{"first": first, "second": second, "unused": unused}
	plan := linkPlan{Consumers: []linkConsumer{{Path: consumer, Targets: targets}, {Path: first, Targets: targets}, {Path: second, Targets: targets}}}
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root}}
	if err := validateLinkedPeerContracts(w, plan); err != nil {
		t.Fatal(err)
	}
	writeGraphFixture(t, filepath.Join(first, "package.json"), `{"dependencies":{"second":"1.0.0","react":"19.0.0"}}`)
	if err := validateLinkedPeerContracts(w, plan); err == nil || !strings.Contains(err.Error(), "host/first/package.json") || !strings.Contains(err.Error(), "host/second/package.json") {
		t.Fatalf("direct provider conflict missed: %v", err)
	}
	plan.Composition = &devcompose.Plan{Files: []devcompose.File{{Path: filepath.Join(root, "pnpm-workspace.yaml"), Data: []byte("overrides:\n  react: 20.0.0\n")}}}
	if err := validateLinkedPeerContracts(w, plan); err != nil {
		t.Fatalf("policy-adjusted peers must remain native resolver's decision: %v", err)
	}
}

func TestManifestRangesDisjoint(t *testing.T) {
	for _, test := range []struct {
		left, right string
		want        bool
	}{
		{"1.2.3", "1.2.3", false},
		{"1.2.3", "1.2.4", true},
		{"1.3.0", "~1.2.3", true},
		{"1.2.9", "~1.2.3", false},
		{"0.3.0", "^0.2.1", true},
		{"0.0.2", "^0.0.1", true},
		{"^1.0.0", "~1.3.0", false},
		{"^1.0.0", "^2.0.0", true},
		{"1.0.0-beta.1", "^1.0.0", false},
		{"npm:react@19.0.0", "^20.0.0", false},
		{"19.0.0", "^18.0.0 || ^19.0.0", false},
	} {
		if got := manifestRangesDisjoint(test.left, test.right); got != test.want {
			t.Errorf("%q versus %q: got %v, want %v", test.left, test.right, got, test.want)
		}
	}
}

func TestLinkPlanningRejectsPeerConflictBeforeInstallation(t *testing.T) {
	graph := graphFixture(t)
	root := graph.workspace.Root
	writeGraphFixture(t, filepath.Join(root, "plugin/ui/package.json"), `{"name":"plugin-ui","private":true,"version":"1.0.0","packageManager":"pnpm@12.14.0","dependencies":{"@omniviewdev/runtime":"1.0.0","@tanstack/react-query":"5.90.21"}}`)
	writeGraphFixture(t, filepath.Join(root, "host/packages/omniviewdev-runtime/package.json"), `{"name":"@omniviewdev/runtime","private":true,"version":"1.0.0","peerDependencies":{"@tanstack/react-query":"^5.105.0"}}`)
	_, err := makeLinkPlan(graph.workspace)
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "peer_contract_mismatch" {
		t.Fatalf("planning must diagnose incompatible sources without an installer: %v", err)
	}
}
