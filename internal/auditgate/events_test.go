package auditgate

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func eventFrame(name string) []byte {
	return []byte(fmt.Sprintf(`{"name":%q,"data":null}`, name))
}

func TestFilterEventFrameForwardsAllowedEvents(t *testing.T) {
	policy := defaultPolicy(t)
	for _, name := range []string{
		"plugin/state_change",
		"plugin/init_complete",
		"plugin/inventory_changed",
		"plugin/devserver/status",
		"plugin/devserver/log",
		"connection/status",
		"source/STATE",
		"resource/connection/metadata",
		"settings/changed",
		"windows/changed",
		"metric/observation",
		"activity/observation-error",
		"core/networker/portforward/created",
		// Logs are allowed by decision: the remote browser can read them.
		"core/logs/lines/session-1",
		"core/logs/event/session-1",
		"plugin/process/log",
		"internal/log/update:host",
		"internal/log/update:plugin",
		"core/metrics/data/sub-1",
		"core/metrics/error/sub-1",
		"activity/change/abc123",
		"resource/source-view/0f8fad5b-d9cb-469f-a165-70867728950e",
		// Names that embed a plugin and connection identifier.
		"kubernetes/connection/sync",
		"kubernetes/minikube/source/STATE",
		"aws/ctx with spaces/source/STATE",
		"aws/arn:aws:eks:us-east-1:123456789012:cluster/prod/source/STATE",
		"kubernetes/minikube/graph/CHANGED",
	} {
		t.Run(name, func(t *testing.T) {
			frame := eventFrame(name)
			verdict := policy.FilterEventFrame(frame)
			require.True(t, verdict.Forward)
			require.Equal(t, EventAllowed, verdict.Reason)
			require.Equal(t, name, verdict.Name)
			require.True(t, verdict.Matched)
			require.Equal(t, Allow, verdict.Rule.Decision)
		})
	}

	t.Run("frames with a payload and a sender", func(t *testing.T) {
		for _, frame := range []string{
			`{"name":"plugin/state_change","data":{"pluginID":"x","from":"a","to":"b"},"sender":"main"}`,
			`{"name":"plugin/state_change","data":[1,2,3]}`,
			`{"name":"plugin/state_change","data":"text","sender":""}`,
			`{"data":{"nested":{"name":"mcp/status"}},"name":"plugin/state_change"}`,
			"  {\"name\" : \"plugin/state_change\" , \"data\" : null}\n",
			`{"name":"plugin/state_change"}`,
		} {
			verdict := policy.FilterEventFrame([]byte(frame))
			require.True(t, verdict.Forward, frame)
		}
	})
}

func TestFilterEventFrameDropsExplicitlyDeniedEvents(t *testing.T) {
	policy := defaultPolicy(t)
	for _, name := range []string{
		"core/exec/stream/stdout/session-1",
		"core/exec/stream/stderr/session-1",
		"core/exec/signal/CLOSE/session-1",
		"core/exec/signal/ERROR/session-1",
		"mcp/status",
		"mcp/config_changed",
		"mcp/tools_changed",
		"mcp/confirmation/requested",
		"mcp/confirmation/resolved",
		"action/stream/action-1",
		"menu/view/terminal/create",
		"menu/context/drawer-tab/close",
		"extensions/diagnostics/request",
		"extensions/inspector/open",
		"windows/drag/begin",
		"windows/tab/deliver",
		"plugin/state_write_error",
		"plugin/deprecated_protocol",
		// A deny rule wins over an allow suffix.
		"mcp/x/connection/sync",
		"core/exec/stream/stdout/abc/source/STATE",
		"windows/drag/x/graph/CHANGED",
	} {
		t.Run(name, func(t *testing.T) {
			verdict := policy.FilterEventFrame(eventFrame(name))
			require.False(t, verdict.Forward)
			require.Equal(t, EventDeniedByRule, verdict.Reason)
			require.Equal(t, name, verdict.Name)
			require.True(t, verdict.Matched)
			require.Equal(t, Deny, verdict.Rule.Decision)
		})
	}
}

func TestFilterEventFrameDropsUnlistedEvents(t *testing.T) {
	policy := defaultPolicy(t)
	for _, name := range []string{
		"plugin/unknown",
		"plugin/crash2",
		"plugin/state_change/",
		"plugin/state_changed",
		"Plugin/state_change",
		"core/other",
		"core/log/lines/x",
		"x",
		"connection/sync",
		"source/state",
		"settings/other",
		"activity/change",
		"resource/source-view",
		"custom/event",
	} {
		t.Run(name, func(t *testing.T) {
			verdict := policy.FilterEventFrame(eventFrame(name))
			require.False(t, verdict.Forward)
			require.Equal(t, EventNotAllowed, verdict.Reason)
			require.Equal(t, name, verdict.Name)
			require.False(t, verdict.Matched)
		})
	}
}

func TestFilterEventFrameDropsMalformedFrames(t *testing.T) {
	policy := defaultPolicy(t)
	tests := []struct {
		name  string
		frame string
	}{
		{"empty", ``},
		{"whitespace", ` `},
		{"null", `null`},
		{"array", `[]`},
		{"string", `"plugin/state_change"`},
		{"number", `7`},
		{"empty object", `{}`},
		{"missing name", `{"data":1}`},
		{"numeric name", `{"name":5}`},
		{"null name", `{"name":null}`},
		{"empty name", `{"name":""}`},
		{"array name", `{"name":["plugin/state_change"]}`},
		{"control character in name", `{"name":"plugin/state\u0000change"}`},
		{"newline in name", `{"name":"plugin/state\nchange"}`},
		{"overlong name", `{"name":"` + strings.Repeat("a", maxEventNameBytes+1) + `"}`},
		{"duplicate name", `{"name":"plugin/state_change","name":"mcp/status"}`},
		{"duplicate name reversed", `{"name":"mcp/status","name":"plugin/state_change"}`},
		{"duplicate data", `{"name":"plugin/state_change","data":1,"data":2}`},
		{"case-folded name", `{"name":"plugin/state_change","Name":"mcp/status"}`},
		{"non-canonical name key", `{"Name":"plugin/state_change"}`},
		{"unknown key", `{"name":"plugin/state_change","extra":1}`},
		{"non-string sender", `{"name":"plugin/state_change","sender":5}`},
		{"null sender", `{"name":"plugin/state_change","sender":null}`},
		{"trailing value", `{"name":"plugin/state_change"} {"name":"mcp/status"}`},
		{"trailing garbage", `{"name":"plugin/state_change"} x`},
		{"truncated", `{"name":"plugin/state_change"`},
		{"unclosed payload", `{"name":"plugin/state_change","data":{"a":`},
		{"malformed payload", `{"name":"plugin/state_change","data":{a:1}}`},
		{"invalid utf-8 in the payload", "{\"name\":\"plugin/state_change\",\"data\":\"\xff\"}"},
		{"invalid utf-8 in the name", "{\"name\":\"plugin/\xffstate\"}"},
		{"byte order mark", "\xef\xbb\xbf{\"name\":\"plugin/state_change\"}"},
		{"binary frame", "\x00\x01\x02"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := policy.FilterEventFrame([]byte(tt.frame))
			require.False(t, verdict.Forward)
			require.Equal(t, EventInvalidFrame, verdict.Reason)
			require.Empty(t, verdict.Name)
			require.False(t, verdict.Matched)
		})
	}

	t.Run("an oversized frame is dropped unread", func(t *testing.T) {
		frame := append([]byte(`{"name":"plugin/state_change","data":"`), make([]byte, MaxEventFrameBytes)...)
		verdict := policy.FilterEventFrame(frame)
		require.False(t, verdict.Forward)
		require.Equal(t, EventFrameTooLarge, verdict.Reason)
	})
}

// The filter classifies by the top-level name only; payload content, however
// adversarial, neither unlocks nor blocks an event.
func TestFilterEventFrameClassifiesOnTheEnvelopeName(t *testing.T) {
	policy := defaultPolicy(t)
	blocked := policy.FilterEventFrame([]byte(`{"name":"mcp/status","data":{"name":"plugin/state_change"}}`))
	require.False(t, blocked.Forward)
	require.Equal(t, "mcp/status", blocked.Name)

	allowed := policy.FilterEventFrame([]byte(`{"name":"plugin/state_change","data":{"name":"mcp/status","name":"x"}}`))
	require.True(t, allowed.Forward)
	require.Equal(t, "plugin/state_change", allowed.Name)
}

func TestClassifyEvent(t *testing.T) {
	policy := defaultPolicy(t)
	decision, rule, matched := policy.ClassifyEvent("core/logs/lines/s")
	require.Equal(t, Allow, decision)
	require.True(t, matched)
	require.Equal(t, EventRule{Match: MatchPrefix, Name: "core/logs/", Decision: Allow, Reason: rule.Reason}, rule)

	decision, rule, matched = policy.ClassifyEvent("nothing/matches")
	require.Equal(t, Deny, decision)
	require.False(t, matched)
	require.Equal(t, EventRule{}, rule)

	invalids := []string{"", "bad\x00name", "bad\nname", strings.Repeat("a", maxEventNameBytes+1), "bad\xffname"}
	for _, invalid := range invalids {
		decision, _, matched = policy.ClassifyEvent(invalid)
		require.Equal(t, Deny, decision, invalid)
		require.False(t, matched, invalid)
	}
}

// The decided drops are part of the contract with the audit; this pins them
// against an accidental allow rule that the shadow check would not catch, such
// as a suffix rule that reaches into a denied namespace.
func TestDecidedEventDropsStayDropped(t *testing.T) {
	policy := defaultPolicy(t)
	for _, name := range []string{
		"core/exec/stream/stdout/s", "core/exec/signal/CLOSE/s",
		"mcp/status", "action/stream/a", "menu/view/zoom/in", "extensions/diagnostics/request",
	} {
		decision, rule, matched := policy.ClassifyEvent(name)
		require.Equal(t, Deny, decision, name)
		require.True(t, matched, "%s must be dropped by an explicit rule", name)
		require.Equal(t, Deny, rule.Decision, name)
	}
}

// FuzzFilterEventFrame states the property behind the filter: whenever a frame
// is forwarded, the name the filter classified is the name Go's decoder and an
// exact-key reader such as a browser's JSON.parse both see, and it is an
// allowed name.
func FuzzFilterEventFrame(f *testing.F) {
	policy := defaultPolicy(f)
	for _, seed := range []string{
		`{"name":"plugin/state_change","data":null}`,
		`{"name":"mcp/status","data":{"name":"plugin/state_change"}}`,
		`{"name":"plugin/state_change","name":"mcp/status"}`,
		`{"name":"plugin/state_change","Name":"mcp/status"}`,
		`{"Name":"plugin/state_change"}`,
		`{"name":"plugin/state_change","data":1,"sender":"main"}`,
		`{"data":[1,2],"name":"core/logs/lines/s"}`,
		`{"name":"core/exec/stream/stdout/s","data":"x"}`,
		`{"name":"a\u0000b"}`,
		`{}`,
		`[]`,
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, frame []byte) {
		verdict := policy.FilterEventFrame(frame)
		if !verdict.Forward {
			return
		}
		var decoded struct {
			Name string `json:"name"`
		}
		require.NoError(t, json.Unmarshal(frame, &decoded))
		var exact map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(frame, &exact))
		var exactName string
		require.NoError(t, json.Unmarshal(exact["name"], &exactName))
		require.Equal(t, verdict.Name, decoded.Name)
		require.Equal(t, verdict.Name, exactName)
		decision, _, _ := policy.ClassifyEvent(verdict.Name)
		require.Equal(t, Allow, decision)
	})
}
