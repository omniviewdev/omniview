package auditgate

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const windowNameRow = `{"method": 18, "name": "Name", "decision": "allow", "reason": "boot"}`

const validPolicy = `{
  "version": 1,
  "wails": "v3.0.0-test",
  "methods": [
    {"fqn": "example.com/pkg.Service.Read", "decision": "allow", "reason": "reads"},
    {"fqn": "example.com/pkg.Service.Write", "decision": "deny", "reason": "writes"}
  ],
  "runtime": [
    {"object": 6, "name": "Window", "reason": "windows", "methods": [
      ` + windowNameRow + `
    ]}
  ],
  "events": [
    {"match": "prefix", "name": "mcp/", "decision": "deny", "reason": "relay"},
    {"match": "exact", "name": "plugin/state_change", "decision": "allow", "reason": "readiness"}
  ]
}`

func TestDefaultPolicyIsValid(t *testing.T) {
	policy, err := Default()
	require.NoError(t, err)

	allow, deny := policy.Counts()
	require.Positive(t, allow)
	require.Positive(t, deny)
	require.Len(t, policy.Methods(), allow+deny)
	require.NotEmpty(t, policy.WailsVersion())
	for _, rule := range policy.Methods() {
		require.Contains(t, []Decision{Allow, Deny}, rule.Decision, rule.FQN)
		require.NotEmpty(t, strings.TrimSpace(rule.Reason), rule.FQN)
	}
}

// The table is reviewed by humans, so a new row must land in a predictable
// place: sorted by name, which also keeps duplicates adjacent in a diff.
func TestEmbeddedTableIsSortedByName(t *testing.T) {
	data, err := policyFiles.ReadFile("policy.json")
	require.NoError(t, err)
	var file policyFile
	require.NoError(t, json.Unmarshal(data, &file))
	for i := 1; i < len(file.Methods); i++ {
		require.Less(t, file.Methods[i-1].FQN, file.Methods[i].FQN, "policy.json methods must be sorted by fqn")
	}
}

func TestDeniedMethodsRemainReachableByID(t *testing.T) {
	policy := defaultPolicy(t)
	for _, rule := range policy.Methods() {
		byID, ok := policy.MethodByID(MethodID(rule.FQN))
		require.True(t, ok, rule.FQN)
		require.Equal(t, rule, byID)
		byName, ok := policy.Method(rule.FQN)
		require.True(t, ok, rule.FQN)
		require.Equal(t, rule, byName)
	}
	_, ok := policy.Method("main.AppService.DoesNotExist")
	require.False(t, ok)
	_, ok = policy.MethodByID(1)
	require.False(t, ok)
}

// The runtime table is part of the attack surface: this pins exactly which
// non-bound runtime calls can ever be allowed, so widening it is a deliberate,
// reviewed change to this test.
func TestRuntimeTableAllowsOnlyReviewedCalls(t *testing.T) {
	policy := defaultPolicy(t)
	var allowed []string
	var objects []string
	for _, object := range policy.RuntimeObjects() {
		objects = append(objects, fmt.Sprintf("%d:%s", object.Object, object.Name))
		for _, method := range object.Methods {
			if method.Decision == Allow {
				allowed = append(allowed, fmt.Sprintf("%s.%s=%d.%d", object.Name, method.Name, object.Object, method.Method))
			}
		}
	}
	require.Equal(t, []string{
		"0:Call", "1:Clipboard", "2:Application", "3:Events", "4:ContextMenu", "5:Dialog",
		"6:Window", "7:Screens", "8:System", "9:Browser", "10:CancelCall", "11:iOS", "12:Android",
	}, objects)
	require.Equal(t, []string{
		"Call.CallBinding=0.0",
		"Window.IsFullscreen=6.13",
		"Window.IsMaximised=6.14",
		"Window.Name=6.18",
		"System.IsDarkMode=8.0",
		"System.Environment=8.1",
		"System.Capabilities=8.2",
		"CancelCall.Cancel=10.0",
	}, allowed)

	rule, ok := policy.RuntimeMethod(6, 18)
	require.True(t, ok)
	require.Equal(t, "Name", rule.Name)
	_, ok = policy.RuntimeMethod(6, 2)
	require.False(t, ok, "Window.Close is not listed and therefore denied")
	object, ok := policy.RuntimeObject(2)
	require.True(t, ok)
	require.Equal(t, "Application", object.Name)
	_, ok = policy.RuntimeObject(99)
	require.False(t, ok)
}

// mutate returns the valid table with one textual edit applied.
func mutate(t *testing.T, old, replacement string) string {
	t.Helper()
	require.Contains(t, validPolicy, old)
	return strings.Replace(validPolicy, old, replacement, 1)
}

// addTo returns the valid table with rules put in front of the named array.
func addTo(t *testing.T, array string, rules ...string) string {
	t.Helper()
	opener := `"` + array + `": [`
	return mutate(t, opener, opener+strings.Join(rules, ",")+",")
}

func methodRule(fqn string, decision Decision) string {
	return `{"fqn": "` + fqn + `", "decision": "` + string(decision) + `", "reason": "x"}`
}

func objectRule(object int, name string) string {
	return `{"object": ` + strconv.Itoa(object) + `, "name": "` + name + `", "reason": "x", "methods": []}`
}

func runtimeMethodRule(method int, name string) string {
	return `{"method": ` + strconv.Itoa(method) + `, "name": "` + name + `", "decision": "deny", "reason": "x"}`
}

func eventRule(match EventMatch, name string, decision Decision) string {
	return `{"match": "` + string(match) + `", "name": "` + name +
		`", "decision": "` + string(decision) + `", "reason": "x"}`
}

func TestParseRejectsInvalidTables(t *testing.T) {
	const read = "example.com/pkg.Service.Read"
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"not json", `not json`, "invalid policy"},
		{"trailing data", validPolicy + ` {}`, "trailing data"},
		{"unknown field", mutate(t, `"version": 1,`, `"version": 1, "extra": true,`), "unknown field"},
		{"unsupported version", mutate(t, `"version": 1`, `"version": 2`), "unsupported policy version 2"},
		{"missing wails version", mutate(t, `"wails": "v3.0.0-test",`, ``), "Wails version"},

		{"undecided method", mutate(t, `"decision": "allow", "reason": "reads"`, `"decision": "ask", "reason": "reads"`),
			`use "allow" or "deny"`},
		{"missing method decision", mutate(t, `"decision": "allow", "reason": "reads"`, `"reason": "reads"`),
			`use "allow" or "deny"`},
		{"unexplained method", mutate(t, `"reason": "reads"`, `"reason": "  "`), "has no reason"},
		{"duplicate method", addTo(t, "methods", methodRule(read, Deny)), "duplicate method"},
		{"method without a type", mutate(t, read, `Read`), "invalid method name"},
		{"method with spaces", mutate(t, read, "example.com/pkg.Service. Read"), "invalid method name"},
		{"unexported method", mutate(t, read, "example.com/pkg.Service.read"), "invalid method name"},
		{"overlong method", mutate(t, read, strings.Repeat("a", maxMethodNameBytes)+".Service.Read"),
			"invalid method name"},

		{"negative runtime object", mutate(t, `"object": 6`, `"object": -1`), "invalid runtime object"},
		{"runtime object without a name", mutate(t, `"name": "Window"`, `"name": ""`), "invalid runtime object"},
		{"unexplained runtime object", mutate(t, `"reason": "windows"`, `"reason": ""`), "no reason"},
		{"duplicate runtime object", addTo(t, "runtime", objectRule(6, "Other")), "duplicate runtime object 6"},
		{"duplicate runtime object name", addTo(t, "runtime", objectRule(7, "Window")),
			"duplicate runtime object name"},
		{"undecided runtime method",
			mutate(t, `"decision": "allow", "reason": "boot"`, `"decision": "maybe", "reason": "boot"`),
			"has decision"},
		{"unexplained runtime method", mutate(t, `"reason": "boot"`, `"reason": ""`), "has no reason"},
		{"duplicate runtime method", mutate(t, windowNameRow, runtimeMethodRule(18, "Other")+","+windowNameRow),
			"duplicate runtime method"},
		{"duplicate runtime method name", mutate(t, windowNameRow, runtimeMethodRule(3, "Name")+","+windowNameRow),
			"duplicate runtime method name"},
		{"negative runtime method", mutate(t, `"method": 18`, `"method": -2`), "invalid runtime method"},

		{"unknown event match", mutate(t, `"match": "prefix"`, `"match": "regex"`), "unknown match"},
		{"empty event name", mutate(t, `"name": "mcp/"`, `"name": ""`), "invalid event rule name"},
		{"event name with whitespace", mutate(t, `"name": "mcp/"`, `"name": "mcp /"`), "invalid event rule name"},
		{"undecided event rule", mutate(t, `"decision": "deny", "reason": "relay"`, `"decision": "", "reason": "relay"`),
			"has decision"},
		{"unexplained event rule", mutate(t, `"reason": "relay"`, `"reason": ""`), "has no reason"},
		{"duplicate event rule", addTo(t, "events", eventRule(MatchPrefix, "mcp/", Deny)), "duplicate event rule"},
		{"allow rule shadowed by a deny prefix", addTo(t, "events", eventRule(MatchExact, "mcp/status", Allow)),
			"unreachable"},
		{"allow prefix shadowed by a deny prefix", addTo(t, "events", eventRule(MatchPrefix, "mcp/tools/", Allow)),
			"unreachable"},
		{"contradictory exact event rules",
			addTo(t, "events", eventRule(MatchExact, "gone", Deny), eventRule(MatchExact, "gone", Allow)),
			"duplicate event rule"},
		{"allow suffix shadowed by a deny suffix",
			addTo(t, "events", eventRule(MatchSuffix, "/sync", Deny), eventRule(MatchSuffix, "/connection/sync", Allow)),
			"unreachable"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := Parse([]byte(tt.input))
			require.Nil(t, policy)
			require.ErrorContains(t, err, tt.want)
		})
	}

	t.Run("the base table is valid", func(t *testing.T) {
		policy, err := Parse([]byte(validPolicy))
		require.NoError(t, err)
		require.Equal(t, "v3.0.0-test", policy.WailsVersion())
		allow, deny := policy.Counts()
		require.Equal(t, 1, allow)
		require.Equal(t, 1, deny)
	})

	t.Run("an allow rule outside every deny rule is accepted", func(t *testing.T) {
		_, err := Parse([]byte(addTo(t, "events", eventRule(MatchPrefix, "mcpx/", Allow))))
		require.NoError(t, err)
	})
}

// Two methods that hash to one binding ID would make an ID ambiguous; Wails
// refuses to start in that case and so does the table.
func TestParseRejectsBindingIDCollision(t *testing.T) {
	seen := make(map[uint32]string)
	var first, second string
	for i := 0; second == ""; i++ {
		name := fmt.Sprintf("example.com/pkg.Service.M%d", i)
		id := MethodID(name)
		if other, clash := seen[id]; clash {
			first, second = other, name
			break
		}
		seen[id] = name
	}
	table := `{"version":1,"wails":"v","methods":[` + methodRule(first, Allow) + `,` + methodRule(second, Allow) +
		`],"runtime":[],"events":[]}`
	_, err := Parse([]byte(table))
	require.ErrorContains(t, err, "share binding id")
}

// Go's decoder keeps the last of repeated keys and matches keys without regard
// to case, so a table with such a key would load differently from how a
// reviewer reads the file. Parse refuses it.
func TestParseRejectsRepeatedAndCaseVariantKeys(t *testing.T) {
	const methodRow = `{"fqn": "example.com/pkg.Service.Read", "decision": "allow", "reason": "reads"}`
	const eventRow = `{"match": "prefix", "name": "mcp/", "decision": "deny", "reason": "relay"}`
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"repeated top-level key", mutate(t, `"version": 1,`, `"version": 1, "version": 1,`), "duplicate key"},
		{"repeated key in a method row", mutate(t, methodRow,
			`{"fqn": "example.com/pkg.Service.Read", "decision": "deny", "decision": "allow", "reason": "reads"}`),
			"duplicate key"},
		{"case variant of a method row key", mutate(t, methodRow,
			`{"fqn": "example.com/pkg.Service.Read", "decision": "deny", "Decision": "allow", "reason": "reads"}`),
			"case folded key"},
		{"case variant of a top-level key",
			mutate(t, `"wails": "v3.0.0-test",`, `"wails": "v3.0.0-test", "WAILS": "x",`), "case folded key"},
		{"repeated key in an event rule", mutate(t, eventRow,
			`{"match": "prefix", "name": "mcp/", "decision": "deny", "decision": "allow", "reason": "relay"}`),
			"duplicate key"},
		{"repeated key in a runtime method", mutate(t, windowNameRow,
			`{"method": 18, "name": "Name", "decision": "allow", "decision": "deny", "reason": "boot"}`),
			"duplicate key"},
		{"repeated key written with an escape", mutate(t, `"version": 1,`, `"version": 1, "\u0076ersion": 2,`),
			"duplicate key"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := Parse([]byte(tt.input))
			require.Nil(t, policy)
			require.ErrorContains(t, err, tt.want)
		})
	}
}

// window.Service.GetState can open a saved native window on the host desktop
// when it is handed the restore-gate name, and needs no window header to do
// so; ListStates returns every window's saved UI state. The UI boots to its
// default state without either, so both stay denied, while List (without
// which the UI cannot identify its window) stays allowed.
func TestWindowStateReadsStayDenied(t *testing.T) {
	policy := defaultPolicy(t)
	const window = "github.com/omniviewdev/omniview/backend/window.Service."
	for _, method := range []string{"GetState", "ListStates", "SaveState", "Open", "OpenSettings"} {
		rule, ok := policy.Method(window + method)
		require.True(t, ok, method)
		require.Equal(t, Deny, rule.Decision, method)
	}
	rule, ok := policy.Method(window + "List")
	require.True(t, ok)
	require.Equal(t, Allow, rule.Decision, "the UI cannot identify its window without List")
}
