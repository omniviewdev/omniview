package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/plugin-sdk/pkg/profilecontract"
)

// ambiguousExitCodes are typed codes that different constructors give different
// exits. A code table restores one exit per code, so each is acknowledged here
// with the exit the table restores: the blocking exit where constructors
// disagree.
var ambiguousExitCodes = map[string]int{
	// Journal refusals in the workspace block (4); the profile contract's
	// invalid_journal is a usage error (2).
	"invalid_journal":          4,
	"invalid_process_bridge":   4,
	"invalid_registry":         4,
	"overlapping_repositories": 4,
	// The exit is the native removal child's status (2, 4, 5 or 7).
	"native_profile_purge_failed": 5,
}

// dynamicTypedConstructors lists, as "package/file.go:function", every
// devcontract.Fail call whose code or exit is computed, so the scan cannot read
// it, with the codes it can produce and the exits it can give them. A dynamic
// call missing from this list fails the scan, so a new computed constructor
// cannot silently escape the exit table; a listed entry the scan no longer finds
// fails as stale. A nil entry is a wrapper whose literal call sites the scan
// reads instead.
var dynamicTypedConstructors = map[string]map[string][]int{
	"devworkspace/source_update.go:sourceUpdateFailure": nil,
	"devcontract/customprofile.go:profileReadError": {
		// The plugin-sdk profile contract's codes: a usage error (2) except a
		// conflicting state root. TestProfileContractCodesMatchTheHandList
		// compares this list with the SDK source.
		"invalid_profile_binding": {2}, "conflicting_state_root": {4}, "invalid_journal": {2},
	},
	"devcontrol/server.go:safeError": {
		// Application error categories mapped to the control protocol's codes.
		"dependency_failed": {5}, "not_found": {3}, "conflict": {4}, "validation_failed": {2}, "timeout": {7},
		"committed_cleanup_pending": {5}, "commit_uncertain": {5},
	},
	"devworkspace/native_run.go:runNativeRemovalCommand": {"native_profile_purge_failed": {2, 4, 5, 7}},
}

// Every typed constructor with a non-default exit must survive the JSON status
// boundary, where Error.Exit is not serialized. Scanning the constructors keeps
// the table from drifting when a code is added; constructors whose code or exit
// is computed must be listed by hand so they cannot be skipped silently.
func TestWorkspaceExitCodesCoverEveryTypedConstructor(t *testing.T) {
	directories := []string{".", "../devsession", "../devcontract", "../devcontrol", "../devcontrol/host", "../../backend/pkg/plugin/devserver"}
	fset := token.NewFileSet()
	observed := map[string]map[int][]string{} // code -> exit -> constructing sites
	note := func(code string, exit int, site string) {
		if observed[code] == nil {
			observed[code] = map[int][]string{}
		}
		observed[code][exit] = append(observed[code][exit], site)
	}
	dynamic := map[string]bool{}
	literal := 0
	for _, directory := range directories {
		absolute, err := filepath.Abs(directory)
		require.NoError(t, err)
		packageName := filepath.Base(absolute)
		entries, err := os.ReadDir(directory)
		require.NoError(t, err)
		type parsedFile struct {
			name string
			file *ast.File
		}
		var files []parsedFile
		constants := map[string]string{}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			file, parseErr := parser.ParseFile(fset, filepath.Join(directory, entry.Name()), nil, 0)
			require.NoError(t, parseErr)
			files = append(files, parsedFile{entry.Name(), file})
			for _, declaration := range file.Decls {
				generic, ok := declaration.(*ast.GenDecl)
				if !ok || generic.Tok != token.CONST {
					continue
				}
				for _, spec := range generic.Specs {
					value := spec.(*ast.ValueSpec)
					for index, name := range value.Names {
						if index >= len(value.Values) {
							continue
						}
						if basic, isLiteral := value.Values[index].(*ast.BasicLit); isLiteral {
							constants[name.Name] = basic.Value
						}
					}
				}
			}
		}
		resolve := func(expression ast.Expr) (string, bool) {
			switch node := expression.(type) {
			case *ast.BasicLit:
				return node.Value, true
			case *ast.Ident:
				if node.Obj != nil && node.Obj.Kind != ast.Con {
					return "", false // a local variable or parameter
				}
				value, found := constants[node.Name]
				return value, found
			}
			return "", false
		}
		for _, parsed := range files {
			for _, declaration := range parsed.file.Decls {
				owner := "<package>"
				if function, isFunction := declaration.(*ast.FuncDecl); isFunction {
					owner = function.Name.Name
				}
				site := packageName + "/" + parsed.name + ":" + owner
				ast.Inspect(declaration, func(node ast.Node) bool {
					call, ok := node.(*ast.CallExpr)
					if !ok || len(call.Args) < 2 {
						return true
					}
					var exitText, codeText string
					var exitKnown, codeKnown bool
					switch function := call.Fun.(type) {
					case *ast.SelectorExpr:
						if owner, isIdent := function.X.(*ast.Ident); !isIdent || owner.Name != "devcontract" || function.Sel.Name != "Fail" {
							return true
						}
						exitText, exitKnown = resolve(call.Args[0])
						codeText, codeKnown = resolve(call.Args[1])
					case *ast.Ident:
						switch function.Name {
						case "Fail":
							if packageName != "devcontract" {
								return true
							}
							exitText, exitKnown = resolve(call.Args[0])
							codeText, codeKnown = resolve(call.Args[1])
						case "sourceUpdateFailure":
							exitText, exitKnown = constants["sourceUpdateConflictExitCode"], true
							codeText, codeKnown = resolve(call.Args[0])
						default:
							return true
						}
					default:
						return true
					}
					exit, exitErr := strconv.Atoi(exitText)
					code, codeErr := strconv.Unquote(codeText)
					if !exitKnown || !codeKnown || exitErr != nil || codeErr != nil {
						dynamic[site] = true
						return true
					}
					note(code, exit, fset.Position(call.Pos()).String())
					literal++
					return true
				})
			}
		}
	}
	for site, codes := range dynamicTypedConstructors {
		for code, exits := range codes {
			for _, exit := range exits {
				note(code, exit, site)
			}
		}
	}

	var unlisted, stale []string
	for site := range dynamic {
		if _, listed := dynamicTypedConstructors[site]; !listed {
			unlisted = append(unlisted, site)
		}
	}
	for site := range dynamicTypedConstructors {
		if !dynamic[site] {
			stale = append(stale, site)
		}
	}
	sort.Strings(unlisted)
	sort.Strings(stale)
	require.Empty(t, unlisted, "a devcontract.Fail call computes its code or exit; list it in dynamicTypedConstructors with the codes and exits it can produce")
	require.Empty(t, stale, "dynamicTypedConstructors lists a constructor the scan no longer finds as dynamic")

	var wrong []string
	for code, byExit := range observed {
		var exits []int
		for exit := range byExit {
			exits = append(exits, exit)
		}
		sort.Ints(exits)
		restored := workspaceExitCode(code)
		want, acknowledged := ambiguousExitCodes[code]
		switch {
		case len(exits) > 1 && !acknowledged:
			wrong = append(wrong, fmt.Sprintf("%s is constructed with several exits %v; acknowledge it in ambiguousExitCodes", code, exits))
		case len(exits) > 1 && (restored != want || !slices.Contains(exits, want)):
			wrong = append(wrong, fmt.Sprintf("%s: exits %v are acknowledged as ambiguous but the table restores %d (acknowledged %d)", code, exits, restored, want))
		case len(exits) == 1 && acknowledged:
			wrong = append(wrong, fmt.Sprintf("%s is acknowledged as ambiguous but only exit %d constructs it", code, exits[0]))
		case len(exits) == 1 && restored != exits[0]:
			wrong = append(wrong, fmt.Sprintf("%s: devcontract.Fail(%d) at %v restores exit %d across the supervisor boundary; add it to workspaceExitCodes", code, exits[0], byExit[exits[0]], restored))
		}
	}
	for code := range ambiguousExitCodes {
		if _, constructed := observed[code]; !constructed {
			wrong = append(wrong, code+" is acknowledged as ambiguous but nothing constructs it")
		}
	}
	sort.Strings(wrong)
	require.Empty(t, wrong, "typed codes lose or change their exit across the supervisor boundary")
	require.Greater(t, literal, 400, "the scan must see the typed constructors")
}

// The hand-listed profile-contract codes must be the SDK's: the SDK constructs
// them behind unexported helpers, so the scan above cannot read them.
func TestProfileContractCodesMatchTheHandList(t *testing.T) {
	pc := reflect.ValueOf(profilecontract.ReadJSON).Pointer()
	source, _ := runtime.FuncForPC(pc).FileLine(pc)
	directory := filepath.Dir(source)
	if !filepath.IsAbs(source) {
		t.Skipf("cannot locate the compiled SDK source (possibly -trimpath): %q", source)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Skipf("compiled SDK source is not readable: %v", err)
	}
	found := map[string]bool{}
	fset := token.NewFileSet()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file, parseErr := parser.ParseFile(fset, filepath.Join(directory, entry.Name()), nil, 0)
		require.NoError(t, parseErr)
		ast.Inspect(file, func(node ast.Node) bool {
			pair, ok := node.(*ast.KeyValueExpr)
			if !ok {
				return true
			}
			if key, isIdent := pair.Key.(*ast.Ident); isIdent && key.Name == "Code" {
				if basic, isLiteral := pair.Value.(*ast.BasicLit); isLiteral && basic.Kind == token.STRING {
					code, unquoteErr := strconv.Unquote(basic.Value)
					require.NoError(t, unquoteErr)
					found[code] = true
				}
			}
			return true
		})
	}
	listed := map[string]bool{}
	for code := range dynamicTypedConstructors["devcontract/customprofile.go:profileReadError"] {
		listed[code] = true
	}
	require.Equal(t, listed, found, "the plugin-sdk profile contract changed its codes; update dynamicTypedConstructors and the exit table")
}

func TestWorkspaceErrorRestoresExitFromCodeOnly(t *testing.T) {
	for _, test := range []struct {
		code string
		exit int
	}{
		{"usage", 2}, {"sdk_source_required", 2}, {"invalid_profile_binding", 2},
		{"sdk_contract_mismatch", 3}, {"peer_contract_mismatch", 3},
		{"invalid_journal", 4}, {"generated_cleanup_pending", 4}, {"conflicting_state_root", 4}, {"sdk_release_untrusted", 4},
		{"unauthorized", 6}, {"timeout", 7},
		{"build_failed", 5}, {"a_code_nobody_declared", 5},
	} {
		t.Run(test.code, func(t *testing.T) {
			restored := workspaceError(&devcontract.Error{Code: test.code, Message: "rebuilt from JSON"})
			require.Equal(t, test.exit, restored.Exit)
			require.Equal(t, test.code, restored.Code)
		})
	}
	explicit := workspaceError(&devcontract.Error{Code: "peer_contract_mismatch", Exit: 4})
	require.Equal(t, 4, explicit.Exit, "a constructor-assigned exit is never overridden by the table")
}

// A chain can carry several typed errors; the one reported is chosen by
// consequence (conflicts, ownership and trust refusals above failed commands
// above usage, prerequisite, authorization and timeout codes), never by which
// was joined first, and the first in chain order wins within a rank.
func TestWorkspaceErrorRanksTypedErrorsByConsequenceNotJoinOrder(t *testing.T) {
	conflict := devcontract.Fail(4, "generated_conflict", "publication conflict")
	trust := devcontract.Fail(4, sdkReleaseUntrustedCode, "untrusted release")
	command := devcontract.Fail(5, "link_command_failed", "command failed")
	prerequisite := devcontract.Fail(3, "peer_contract_mismatch", "unmet prerequisite")
	usage := devcontract.Fail(2, "invalid_mode", "usage")
	deadline := devcontract.Fail(7, "timeout", "deadline")
	unauthorized := devcontract.Fail(6, "unauthorized", "unauthorized")
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{"conflict joined first", errors.Join(conflict, command), "generated_conflict"},
		{"conflict joined last", errors.Join(command, conflict), "generated_conflict"},
		{"trust joined first", errors.Join(trust, command), sdkReleaseUntrustedCode},
		{"trust joined last", errors.Join(command, trust), sdkReleaseUntrustedCode},
		{"conflict above prerequisite", errors.Join(prerequisite, conflict), "generated_conflict"},
		{"command above prerequisite, first", errors.Join(command, prerequisite), "link_command_failed"},
		{"command above prerequisite, last", errors.Join(prerequisite, command), "link_command_failed"},
		{"command above usage", errors.Join(usage, command), "link_command_failed"},
		{"command above timeout", errors.Join(deadline, command), "link_command_failed"},
		{"command above unauthorized", errors.Join(unauthorized, command), "link_command_failed"},
		{"same rank keeps chain order, blocking", errors.Join(conflict, trust), "generated_conflict"},
		{"same rank keeps chain order, blocking reversed", errors.Join(trust, conflict), sdkReleaseUntrustedCode},
		{"same rank keeps chain order, failures", errors.Join(command, devcontract.Fail(5, "dependency_failed", "dependency")), "link_command_failed"},
		{"same rank keeps chain order, other", errors.Join(prerequisite, usage), "peer_contract_mismatch"},
		{"same rank keeps chain order, other reversed", errors.Join(usage, prerequisite), "invalid_mode"},
		{
			"nested joins and wrapping",
			fmt.Errorf("build: %w", errors.Join(fmt.Errorf("compile: %w", command), fmt.Errorf("publish: %w", errors.Join(prerequisite, conflict)))),
			"generated_conflict",
		},
		{"a single wrapped typed error is unchanged", fmt.Errorf("wrapped: %w", prerequisite), "peer_contract_mismatch"},
		{"untyped text beside a typed error", errors.Join(errors.New("compiler output"), prerequisite), "peer_contract_mismatch"},
	} {
		t.Run(test.name, func(t *testing.T) {
			failure := workspaceError(test.err)
			require.Equal(t, test.want, failure.Code)
			require.Equal(t, workspaceExitCode(test.want), failure.Exit)
		})
	}

	// A rebuilt error has lost its exit: it must rank by the exit its code restores.
	rebuiltConflict := &devcontract.Error{Code: "generated_conflict", Message: "from JSON"}
	rebuiltCommand := &devcontract.Error{Code: "link_command_failed", Message: "from JSON"}
	for _, chain := range []error{errors.Join(rebuiltConflict, rebuiltCommand), errors.Join(rebuiltCommand, rebuiltConflict)} {
		failure := workspaceError(chain)
		require.Equal(t, "generated_conflict", failure.Code)
		require.Equal(t, 4, failure.Exit)
	}
}

func publishedFixtureIdentity(t *testing.T) devsdk.Identity {
	t.Helper()
	identity, err := devsdk.NewPublishedIdentity(devsdk.Published{
		Module: devsdk.Module, Version: "v0.16.0",
		ModuleSum: "h1:q3jMU47l+0APFGpEdbJ4d5NmAnwaloV+siwiu3G4OOU=", GoModSum: "h1:FFxi7m1H27zsC3VwMZ6Z9zVrwIytVTAkRjLT5cpv0G4=",
	})
	require.NoError(t, err)
	return identity
}

// A trust refusal is an exit-4 failure under its own code even when it reaches
// the supervisor boundary as a bare wrapped sentinel, whichever way it was made.
func TestWorkspaceErrorMapsAnUntrustedSDKRefusalToItsTypedExit4Code(t *testing.T) {
	published := publishedFixtureIdentity(t)
	_, verifierErr := devsdk.NewVerifier(devsdk.Policy{})(context.Background(), devsdk.PublishedSelection())
	refusals := map[string]error{
		"bare sentinel":      devsdk.ErrNotAccepted,
		"wrapped sentinel":   fmt.Errorf("verify the selected SDK: %w", devsdk.ErrNotAccepted),
		"default policy":     devsdk.Policy{}.Admit(published),
		"injected policy":    devsdk.NewPolicy(func(devsdk.Published) error { return errors.New("below the accepted floor") }).Admit(published),
		"production verifer": verifierErr,
	}
	for name, refusal := range refusals {
		t.Run(name, func(t *testing.T) {
			require.ErrorIs(t, refusal, devsdk.ErrNotAccepted)
			failure := workspaceError(fmt.Errorf("graph: %w", refusal))
			require.Equal(t, sdkReleaseUntrustedCode, failure.Code)
			require.Equal(t, 4, failure.Exit)
		})
	}

	// Joined text from other failures is never copied into the typed refusal.
	joined := workspaceError(errors.Join(errors.New("go build failed: private compiler output"), fmt.Errorf("verify: %w", devsdk.ErrNotAccepted)))
	require.Equal(t, sdkReleaseUntrustedCode, joined.Code)
	require.NotContains(t, joined.Message, "private compiler output")

	// It outranks a typed failed command in either join order, and yields to nothing of lower rank.
	command := devcontract.Fail(5, "link_command_failed", "command failed")
	for _, chain := range []error{errors.Join(command, devsdk.ErrNotAccepted), errors.Join(devsdk.ErrNotAccepted, command)} {
		failure := workspaceError(chain)
		require.Equal(t, sdkReleaseUntrustedCode, failure.Code)
		require.Equal(t, 4, failure.Exit)
	}
	prerequisite := devcontract.Fail(3, "peer_contract_mismatch", "unmet prerequisite")
	require.Equal(t, sdkReleaseUntrustedCode, workspaceError(errors.Join(prerequisite, devsdk.ErrNotAccepted)).Code)

	// A typed refusal that a later release constructs keeps its details and exit.
	typed := devcontract.Fail(4, sdkReleaseUntrustedCode, "SDK v0.12.0 is below the accepted floor")
	typed.Details = map[string]any{"version": "v0.12.0"}
	failure := workspaceError(errors.Join(typed, devsdk.ErrNotAccepted))
	require.Equal(t, "SDK v0.12.0 is below the accepted floor", failure.Message)
	require.Equal(t, map[string]any{"version": "v0.12.0"}, failure.Details)

	require.Equal(t, 4, workspaceExitCode(sdkReleaseUntrustedCode), "a refusal rebuilt from JSON must keep exit 4")
}

// The real supervisor path: the handler classifies the error, only the code
// crosses the JSON status, and the controller restores the exit from it.
func TestUntrustedSDKRefusalKeepsExit4AcrossTheSupervisorTransport(t *testing.T) {
	const workspaceID = "11111111-1111-4111-8111-111111111111"
	generation := NewGeneration()
	token := []byte("untrusted-sdk-authenticated-supervisor-token")
	refusal := errors.Join(errors.New("go build: private compiler output"),
		fmt.Errorf("verify the selected SDK: %w", devsdk.ErrNotAccepted))
	server := httptest.NewServer(supervisorHandler(workspaceID, generation, token, func(context.Context, string) (Status, error) {
		return Status{Generation: generation}, refusal
	}))
	defer server.Close()
	record := supervisorRecord{WorkspaceID: workspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor"}
	_, err := callSupervisor(context.Background(), record, token, supervisorStatusCommand)
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, sdkReleaseUntrustedCode, failure.Code)
	require.Equal(t, 4, failure.Exit, "exit must survive the json:\"-\" Exit field")
	require.NotContains(t, failure.Message, "private compiler output")
}

// Trust refusals are source-agnostic evidence: a checkout identity is never one.
func TestSourceIdentitiesAreNotTrustRefusals(t *testing.T) {
	source, err := devsdk.NewSourceIdentity(devsource.Identity{
		Directory: filepath.Join(t.TempDir(), "sdk"), Revision: strings.Repeat("a", 40), SourceDigest: strings.Repeat("b", 64),
	})
	require.NoError(t, err)
	require.NoError(t, devsdk.Policy{}.Admit(source))
	require.Equal(t, "launch_failed", workspaceError(errors.New("unclassified")).Code)
}
