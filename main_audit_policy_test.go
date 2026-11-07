package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/internal/auditgate"
)

// These tests keep the audit gateway allowlist (internal/auditgate/policy.json)
// in step with the Go services the host binds to the page. A method that is
// bound but not classified, a stale row, a renumbered runtime call or a binding
// alias all fail here, so the allowlist cannot silently drift open.

func auditPolicy(t testing.TB) *auditgate.Policy {
	t.Helper()
	policy, err := auditgate.Default()
	require.NoError(t, err)
	return policy
}

// reflectedFQNs lists every bound method of boundServiceTypes under the names
// the host binary reports. A test binary compiles package main under its
// import path while the real binary reports "main", which is also what the
// generated bindings hash.
func reflectedFQNs(t testing.TB) []string {
	t.Helper()
	fqns, err := auditgate.BoundMethodFQNs(boundServiceTypes()...)
	require.NoError(t, err)
	if testPath := reflect.TypeFor[AppService]().PkgPath(); testPath != "main" {
		prefix := testPath + "."
		for i, fqn := range fqns {
			if rest, ok := strings.CutPrefix(fqn, prefix); ok {
				fqns[i] = "main." + rest
			}
		}
		sort.Strings(fqns)
	}
	return fqns
}

func TestEveryBoundMethodIsClassified(t *testing.T) {
	policy := auditPolicy(t)
	reflected := make(map[string]struct{})
	var unclassified []string
	for _, fqn := range reflectedFQNs(t) {
		reflected[fqn] = struct{}{}
		if _, ok := policy.Method(fqn); !ok {
			unclassified = append(unclassified, fqn)
		}
	}
	require.Empty(t, unclassified,
		"bound methods missing from internal/auditgate/policy.json: "+
			"classify each as allow or deny (docs/development-audit-gateway.md)")

	var stale []string
	for _, rule := range policy.Methods() {
		if _, ok := reflected[rule.FQN]; !ok {
			stale = append(stale, rule.FQN)
		}
	}
	require.Empty(t, stale, "policy.json rows without a bound method: remove or rename them")
}

// The hook that main runs before registering services must accept the real
// services and refuse an unreviewed one. AppService is covered by
// TestEveryBoundMethodIsClassified: under go test its names carry the import
// path instead of "main".
func TestStartupAuditCheckCoversRegisteredServices(t *testing.T) {
	var others []any
	for _, service := range boundServiceTypes() {
		if _, isApp := service.(*AppService); !isApp {
			others = append(others, service)
		}
	}
	require.NoError(t, checkAuditPolicy(others...))

	err := checkAuditPolicy(&unreviewedService{})
	require.ErrorContains(t, err, "unreviewedService.Unreviewed")
	require.ErrorContains(t, err, "policy.json")
}

type unreviewedService struct{}

func (*unreviewedService) Unreviewed() {}

// boundServiceTypes is hand-maintained, so make it impossible to register a
// service in main without declaring it there, including services that expose
// no bound method and therefore leave no trace in the generated bindings.
func TestBoundServiceTypesDeclareEveryRegisteredService(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, parser.SkipObjectResolution)
	require.NoError(t, err)
	registrations := 0
	ast.Inspect(file, func(node ast.Node) bool {
		call, isCall := node.(*ast.CallExpr)
		if isCall && isNewServiceCall(call) {
			registrations++
		}
		return true
	})
	require.Len(t, boundServiceTypes(), registrations,
		"main.go registers %d services: keep boundServiceTypes in step", registrations)
}

var byIDPattern = regexp.MustCompile(`\$Call\.ByID\((\d+)`)

// generatedBindingIDs returns the method IDs the Wails generator emitted, with
// one file that uses each ID.
func generatedBindingIDs(t testing.TB) map[uint32]string {
	t.Helper()
	root := filepath.Join("packages", "omniviewdev-runtime", "src", "bindings")
	ids := make(map[uint32]string)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".ts") {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, match := range byIDPattern.FindAllSubmatch(content, -1) {
			id, parseErr := strconv.ParseUint(string(match[1]), 10, 32)
			if parseErr != nil {
				return fmt.Errorf("%s: binding id %s: %w", path, match[1], parseErr)
			}
			ids[uint32(id)] = path
		}
		return nil
	})
	require.NoError(t, err)
	require.NotEmpty(t, ids, "no generated bindings found under %s", root)
	return ids
}

// The generated bindings call every method by the FNV-1a hash of its fully
// qualified name, which is exactly what the policy hashes. A mismatch means a
// service is registered but missing from boundServiceTypes, the bindings are
// stale, the generator and reflection disagree about the bound set, or the
// name guessed for package main is wrong.
func TestPolicyMatchesGeneratedBindings(t *testing.T) {
	computed := make(map[uint32]string)
	for _, fqn := range reflectedFQNs(t) {
		computed[auditgate.MethodID(fqn)] = fqn
	}
	generated := generatedBindingIDs(t)

	var notGenerated, notBound []string
	for id, fqn := range computed {
		if _, ok := generated[id]; !ok {
			notGenerated = append(notGenerated, fqn)
		}
	}
	for id, path := range generated {
		if _, ok := computed[id]; !ok {
			notBound = append(notBound, fmt.Sprintf("%d in %s", id, path))
		}
	}
	sort.Strings(notGenerated)
	sort.Strings(notBound)
	require.Empty(t, notGenerated,
		"bound methods absent from the generated bindings: run `task bindings`")
	require.Empty(t, notBound,
		"generated bindings for methods the policy does not enumerate: "+
			"list the service in boundServiceTypes (main.go) and classify its methods")
	require.Len(t, generated, len(computed))
}

// callBody builds a Call request whose method selector is the given member.
func callBody(selector string) string {
	return `{"object":0,"method":0,"args":{"call-id":"c1",` + selector + `,"args":[]}}`
}

func runtimeRequest(body string) auditgate.RuntimeRequest {
	return auditgate.RuntimeRequest{
		Method:       "POST",
		Path:         "/wails/runtime",
		RawQuery:     "",
		Header:       map[string][]string{"Content-Type": {"application/json"}},
		Body:         []byte(body),
		CallIDPrefix: "",
	}
}

// TestDangerousMethodsStayDenied pins the methods whose exposure would give a
// remote browser the OS user's authority. Flipping one of them to allow must
// fail here and be a deliberate, reviewed change to this list.
func TestDangerousMethodsStayDenied(t *testing.T) {
	policy := auditPolicy(t)
	const (
		plugin = "github.com/omniviewdev/omniview/backend/pkg/plugin"
		mcp    = "github.com/omniviewdev/omniview/internal/mcprelay.ServiceWrapper."
	)
	sentinels := []string{
		// A local PTY shell and its input, as the OS user.
		plugin + "/exec.ServiceWrapper.CreateTerminal",
		plugin + "/exec.ServiceWrapper.CreateSession",
		plugin + "/exec.ServiceWrapper.WriteSession",
		plugin + "/exec.ServiceWrapper.AttachSession",
		plugin + "/exec.ServiceWrapper.OpenNativeSession",
		// Arbitrary file write and native dialogs on the host.
		"main.AppService.WriteFileContent",
		"main.AppService.OpenFileSelectionDialog",
		"main.AppService.SaveFileDialog",
		// Installing, linking and starting plugin executables.
		plugin + ".ServiceWrapper.InstallPluginFromPath",
		plugin + ".ServiceWrapper.InstallDevPluginFromPath",
		plugin + ".ServiceWrapper.InstallInDevMode",
		plugin + ".ServiceWrapper.InstallFromPathPrompt",
		plugin + ".ServiceWrapper.InstallPluginVersion",
		plugin + ".ServiceWrapper.LoadPlugin",
		plugin + ".ServiceWrapper.ReloadPlugin",
		plugin + ".ServiceWrapper.UninstallPlugin",
		plugin + ".ServiceWrapper.UnlinkDevPlugin",
		plugin + ".ServiceWrapper.SetPluginEnabled",
		plugin + "/devserver.ServiceWrapper.StartDevServerForPath",
		plugin + "/devserver.ServiceWrapper.StartDevServer",
		// Settings, ports and remote mutations.
		"github.com/omniviewdev/omniview/backend/pkg/settings.Binding.Commit",
		plugin + "/networker.ServiceWrapper.StartResourcePortForwardingSession",
		plugin + "/resource.ServiceWrapper.Mutate",
		plugin + "/resource.ServiceWrapper.Action",
		plugin + "/resource.ServiceWrapper.SaveConnectionProfile",
		plugin + "/resource.ServiceWrapper.RemoveConnection",
		// Metric provider credentials and activity writes.
		plugin + "/metric.ServiceWrapper.SaveProviderConnection",
		plugin + "/data.ServiceWrapper.Set",
		"github.com/omniviewdev/omniview/backend/pkg/activity.FrontendService.StartResourceAction",
		// The MCP relay: its bearer token, its approvals, its listener.
		mcp + "GetConfig",
		mcp + "RotateToken",
		mcp + "ResolveConfirmation",
		mcp + "SetEnabled",
		mcp + "SetPort",
	}

	reflected := make(map[string]struct{})
	relay := 0
	for _, fqn := range reflectedFQNs(t) {
		reflected[fqn] = struct{}{}
		if strings.HasPrefix(fqn, mcp) {
			sentinels = append(sentinels, fqn) // the whole relay surface stays denied
			relay++
		}
	}
	require.NotZero(t, relay, "the MCP relay service is no longer bound: update this test")
	for _, fqn := range sentinels {
		_, bound := reflected[fqn]
		require.True(t, bound, "sentinel %s is not a bound method any more: update this list", fqn)
		rule, ok := policy.Method(fqn)
		require.True(t, ok, fqn)
		require.Equal(t, auditgate.Deny, rule.Decision, "%s must stay denied", fqn)

		id := strconv.FormatUint(uint64(auditgate.MethodID(fqn)), 10)
		for name, body := range map[string]string{
			"by name": callBody(`"methodName":` + strconv.Quote(fqn)),
			"by id":   callBody(`"methodID":` + id),
		} {
			verdict := policy.EvaluateRuntime(runtimeRequest(body))
			require.False(t, verdict.Allowed, "%s %s", fqn, name)
			require.Equal(t, auditgate.ReasonMethodDenied, verdict.Reason, "%s %s", fqn, name)
			require.Equal(t, fqn, verdict.FQN)
		}
	}

	// Wails runtime objects that act on the host must stay unreachable.
	for _, body := range []string{
		`{"object":2,"method":2}`,                                 // Application.Quit
		`{"object":9,"method":0,"args":{"url":"https://x.test"}}`, // Browser.OpenURL
		`{"object":3,"method":0,"args":{"name":"mcp/status"}}`,    // Events.Emit
		`{"object":1,"method":1}`,                                 // Clipboard.Text
		`{"object":5,"method":0,"args":{}}`,                       // Dialog
		`{"object":6,"method":2}`,                                 // Window.Close
		`{"object":6,"method":19}`,                                // Window.OpenDevTools
		`{"object":8,"method":3}`,                                 // System.Flags
	} {
		verdict := policy.EvaluateRuntime(runtimeRequest(body))
		require.False(t, verdict.Allowed, body)
	}
}

var registeredEventPattern = regexp.MustCompile(`export const \w+ = "([^"]+)";`)

// Every event the host registers by name must be classified by an explicit
// rule, so adding one forces a decision instead of falling to the default drop.
func TestRegisteredEventNamesAreClassified(t *testing.T) {
	policy := auditPolicy(t)
	path := filepath.Join("packages", "omniviewdev-runtime", "src", "bindings", "events", "index.ts")
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	matches := registeredEventPattern.FindAllSubmatch(content, -1)
	require.NotEmpty(t, matches, "no registered events found in %s", path)

	var unclassified []string
	for _, match := range matches {
		name := string(match[1])
		if _, _, matched := policy.ClassifyEvent(name); !matched {
			unclassified = append(unclassified, name)
		}
	}
	require.Empty(t, unclassified,
		"registered events with no explicit rule in internal/auditgate/policy.json: allow or drop each one")
}

// The event filter reads Wails' own frame encoding; marshal real events to be
// sure the shapes agree.
func TestEventFilterReadsWailsFrames(t *testing.T) {
	policy := auditPolicy(t)
	tests := []struct {
		name    string
		event   *application.CustomEvent
		forward bool
	}{
		{"object payload", &application.CustomEvent{
			Name: "plugin/state_change", Data: map[string]any{"pluginID": "p", "to": "running"},
		}, true},
		{"no payload", &application.CustomEvent{Name: "plugin/init_complete"}, true},
		{"sender and array payload", &application.CustomEvent{
			Name: "windows/changed", Data: []any{1, "a"}, Sender: "main",
		}, true},
		{"log lines", &application.CustomEvent{Name: "core/logs/lines/s1", Data: "line one\nline two"}, true},
		{"dropped terminal output", &application.CustomEvent{Name: "core/exec/stream/stdout/s1", Data: "bytes"}, false},
		{"dropped mcp event", &application.CustomEvent{
			Name: "mcp/confirmation/resolved", Data: map[string]any{"id": "x"},
		}, false},
		{"unlisted event", &application.CustomEvent{Name: "anything/else", Data: 1}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			frame := tt.event.ToJSON()
			require.NotEmpty(t, frame)
			verdict := policy.FilterEventFrame([]byte(frame))
			require.Equal(t, tt.forward, verdict.Forward, frame)
			require.Equal(t, tt.event.Name, verdict.Name, frame)
		})
	}
}
