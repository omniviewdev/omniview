package auditgate

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

type plainService struct{}

func (*plainService) Read()               {}
func (*plainService) Write(int) error     { return nil }
func (*plainService) hidden()             {}
func (*plainService) ServiceName() string { return "plain" }
func (*plainService) ServiceStartup(context.Context, any) error {
	return nil
}
func (*plainService) ServiceShutdown() error                       { return nil }
func (*plainService) ServeHTTP(http.ResponseWriter, *http.Request) {}

type embedded struct{}

func (embedded) Promoted() {}

type composite struct{ embedded }

func (*composite) Own() {}

type genericService[T any] struct{}

func (*genericService[T]) Method() {}

func servicePackage() string {
	return reflect.TypeFor[plainService]().PkgPath()
}

func TestMethodID(t *testing.T) {
	// The offset basis is the hash of the empty string.
	require.Equal(t, uint32(0x811c9dc5), MethodID(""))
	// Real IDs from the generated bindings of the host (appservice.ts).
	require.Equal(t, uint32(678226073), MethodID("main.AppService.GetInstanceInfo"))
	require.Equal(t, uint32(1706570792), MethodID("main.AppService.GetOperatingSystem"))
}

func TestBoundMethodFQNs(t *testing.T) {
	pkg := servicePackage()
	fqns, err := BoundMethodFQNs(&plainService{}, (*composite)(nil))
	require.NoError(t, err)
	require.Equal(t, []string{
		pkg + ".composite.Own",
		pkg + ".composite.Promoted",
		pkg + ".plainService.Read",
		pkg + ".plainService.Write",
	}, fqns, "Wails binds exported methods, promoted ones included, minus its four lifecycle names")
}

func TestBoundMethodFQNsRejectsWhatWailsRejects(t *testing.T) {
	tests := []struct {
		name     string
		instance any
		want     string
	}{
		{"untyped nil", nil, "not a pointer to a named type"},
		{"value instead of pointer", plainService{}, "not a pointer to a named type"},
		{"pointer to an unnamed type", new(struct{}), "not a pointer to a named type"},
		{"generic type", &genericService[int]{}, "generic"},
		{"function", func() {}, "not a pointer to a named type"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fqns, err := BoundMethodFQNs(tt.instance)
			require.Nil(t, fqns)
			require.ErrorContains(t, err, tt.want)
		})
	}

	t.Run("one type registered twice", func(t *testing.T) {
		_, err := BoundMethodFQNs(&plainService{}, (*plainService)(nil))
		require.ErrorContains(t, err, "registered more than once")
	})
}

func TestVerifyReportsUnclassifiedMethods(t *testing.T) {
	pkg := servicePackage()
	table := `{"version":1,"wails":"v","methods":[
      {"fqn":"` + pkg + `.plainService.Read","decision":"allow","reason":"reads"},
      {"fqn":"` + pkg + `.plainService.Write","decision":"deny","reason":"writes"}],"runtime":[],"events":[]}`
	policy, err := Parse([]byte(table))
	require.NoError(t, err)

	require.NoError(t, policy.Verify(&plainService{}))
	require.NoError(t, policy.Verify())

	err = policy.Verify(&plainService{}, (*composite)(nil))
	var unclassified *UnclassifiedError
	require.ErrorAs(t, err, &unclassified)
	require.Equal(t, []string{pkg + ".composite.Own", pkg + ".composite.Promoted"}, unclassified.FQNs)
	require.ErrorContains(t, err, "policy.json")
	require.ErrorContains(t, err, "composite.Own")

	err = policy.Verify(plainService{})
	require.Error(t, err)
	require.NotErrorAs(t, err, &unclassified)
}

func TestUnclassifiedErrorTruncatesLongLists(t *testing.T) {
	err := &UnclassifiedError{FQNs: []string{
		"a.B.C1", "a.B.C2", "a.B.C3", "a.B.C4", "a.B.C5", "a.B.C6", "a.B.C7", "a.B.C8", "a.B.C9", "a.B.C10",
	}}
	require.ErrorContains(t, err, "10 bound method(s)")
	require.ErrorContains(t, err, "a.B.C8")
	require.ErrorContains(t, err, "(+2 more)")
	require.NotContains(t, err.Error(), "a.B.C9")
}

// The unexported method must stay referenced so linters do not report it.
var _ = (*plainService).hidden
