package mcprelay

import (
	"context"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// failingEventsService is the resource service of a host whose plugin answers a
// resource read with an error that carries the plugin's own words.
type failingEventsService struct {
	*laneService
	err error
}

func (s *failingEventsService) GetResourceEvents(
	context.Context, string, resourcev2.GetRequest, uint32,
) ([]resourcev2.ResourceEvent, error) {
	return nil, s.err
}

const pluginSentence = "PLUGIN-SENTENCE the cluster did not complete the request in time."

// A plugin's sentence reaches the user (apperror.ForResource keeps it), and must
// never reach an agent: the SDK tools contract keeps agent errors a closed
// vocabulary with fixed text, and plugin text that reached an agent would be a
// prompt-injection channel. The boundary is the relay's handler: whatever a
// dispatch returns, the agent is given a fixed string.
func TestPluginErrorTextNeverReachesAnAgent(t *testing.T) {
	typed := &resourcev2.ResourceOperationError{Code: "TIMEOUT", Title: "PLUGIN-TITLE", Message: pluginSentence}
	normalised := apperror.ForResource(typed, "req-1")
	require.Contains(t, normalised.Error(), "PLUGIN-SENTENCE", "the premise: the user is given the sentence")
	restored, err := status.New(codes.Aborted, "resource operation failed").WithDetails(
		&errdetails.ErrorInfo{Reason: "CONFLICT", Domain: "omniview.resource.v2"},
		&errdetails.LocalizedMessage{Locale: "en", Message: pluginSentence},
	)
	require.NoError(t, err)

	const failed = "tool invocation failed"
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"the normalised error":               {normalised, failed},
		"the normalised error, wrapped":      {fmt.Errorf("read: %w", normalised), failed},
		"the typed error":                    {typed, failed},
		"an older client's error and status": {&resourcev2.ResourceOperationError{Err: restored.Err(), Code: "CONFLICT", Message: "resource operation failed"}, failed},
		"a governance denial with text":      {&resourcev2.ResourceOperationError{Code: "GRANT_DENIED", Message: pluginSentence}, "GRANT_DENIED: Cross-plugin connection access is not permitted."},
		"a plain error with text":            {fmt.Errorf("%s", pluginSentence), failed},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			controller, source := generatedController(t)
			source.gets = true
			failing := &failingEventsService{laneService: newLaneService(t, controller), err: tc.err}
			h.relay.connections = &laneHTTPConnections{
				fakeConnections: &fakeConnections{
					Service:     failing,
					connections: map[string][]sdktypes.Connection{"fixture": {{ID: "route-a", Name: "Fixture"}}},
				},
				observer: failing,
			}
			h.relay.resync()
			session := h.connect(t, nil)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			events := findGenerated(t, laneTools(t, failing, ResourceReaders{}), "route-a", opGetResourceEvents)
			result, callErr := session.CallTool(ctx, &mcp.CallToolParams{
				Name: events.MCPName,
				Arguments: map[string]any{
					"connection_id": "route-a", "reference": laneReference(events, "opaque/items"), "limit": 20,
				},
			})
			require.NoError(t, callErr)
			require.True(t, result.IsError)
			require.Len(t, result.Content, 1)
			require.Equal(t, tc.want, result.Content[0].(*mcp.TextContent).Text)
			encoded, marshalErr := json.Marshal(result)
			require.NoError(t, marshalErr)
			require.NotContains(t, string(encoded), "PLUGIN")
			require.Nil(t, result.StructuredContent, "structured failure content does not cross to an agent")
		})
	}
}

// errorResult is the one way a relay failure becomes text an agent reads. Its
// argument must be fixed text. The sites below are the only ones that pass an
// error's own text, and each is host-originated:
//
//   - dispatchGenericKubernetes: the host's validation of the agent's own
//     arguments against descriptors the host built (three sites);
//   - listConnections: ListConnections reads the host's cache and fails only in
//     admission, whose texts are the host's.
//
// A new site that passes an error's text would be the path by which a plugin's
// sentence, which the host now keeps, reaches an agent; this fails until it is
// mapped to fixed text, or reviewed and listed here with its reason.
func TestErrorResultCarriesFixedTextOnly(t *testing.T) {
	reviewed := map[string]int{
		"generic_kubernetes.go:dispatchGenericKubernetes": 3,
		"server.go:listConnections":                       1,
	}
	files, err := filepath.Glob("*.go")
	require.NoError(t, err)
	found := map[string]int{}
	sites := 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, parseErr)
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				if name, isIdent := call.Fun.(*ast.Ident); !isIdent || name.Name != "errorResult" {
					return true
				}
				sites++
				if len(call.Args) == 1 && carriesAnError(call.Args[0]) {
					found[filepath.Base(path)+":"+fn.Name.Name]++
				}
				return true
			})
		}
	}
	require.Greater(t, sites, 30, "the scan found no errorResult sites: it proves nothing")
	require.Equal(t, reviewed, found)
}

// carriesAnError reports whether an expression passes the text of an error: a call
// of Error() or a value named err.
func carriesAnError(expr ast.Expr) bool {
	carries := false
	ast.Inspect(expr, func(n ast.Node) bool {
		switch v := n.(type) {
		case *ast.CallExpr:
			if sel, ok := v.Fun.(*ast.SelectorExpr); ok && sel.Sel.Name == "Error" {
				carries = true
			}
		case *ast.Ident:
			if v.Name == "err" || strings.HasSuffix(v.Name, "Err") {
				carries = true
			}
		}
		return !carries
	})
	return carries
}
