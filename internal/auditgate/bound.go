package auditgate

import (
	"fmt"
	"hash/fnv"
	"reflect"
	"sort"
	"strings"
)

// isInternalServiceMethod reports the exported methods Wails never binds. It
// mirrors the unexported internalServiceMethods map in
// github.com/wailsapp/wails/v3/pkg/application/bindings.go; the drift test
// that compares against the generated bindings detects any divergence.
func isInternalServiceMethod(name string) bool {
	switch name {
	case "ServiceName", "ServiceStartup", "ServiceShutdown", "ServeHTTP":
		return true
	default:
		return false
	}
}

// MethodID returns the identifier Wails assigns to a bound method: the 32-bit
// FNV-1a hash of its fully qualified name. The host registers no binding
// aliases and no registered IDs, so this is also the ID the generated
// bindings call by.
func MethodID(fqn string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(fqn))
	return h.Sum32()
}

// BoundMethodFQNs returns, sorted, the fully qualified name of every method
// Wails binds for the given service instances. Each instance must be a pointer
// to a named, non-generic type, exactly as application.NewService requires; a
// typed nil pointer is enough because only the type is inspected.
//
// The name is PkgPath.TypeName.Method, built the way Wails builds it: every
// exported method of the pointer type (promoted methods included) except
// ServiceName, ServiceStartup, ServiceShutdown and ServeHTTP.
func BoundMethodFQNs(instances ...any) ([]string, error) {
	var fqns []string
	seen := make(map[reflect.Type]struct{}, len(instances))
	for _, instance := range instances {
		ptr := reflect.TypeOf(instance)
		if ptr == nil || ptr.Kind() != reflect.Pointer || ptr.Elem().Name() == "" {
			return nil, fmt.Errorf("auditgate: service %T is not a pointer to a named type", instance)
		}
		named := ptr.Elem()
		if strings.Contains(named.String(), "[") {
			return nil, fmt.Errorf("auditgate: service %s is a generic type; Wails cannot bind it", named)
		}
		if _, dup := seen[ptr]; dup {
			return nil, fmt.Errorf("auditgate: service type %s is registered more than once", named)
		}
		seen[ptr] = struct{}{}
		prefix := named.PkgPath() + "." + named.Name() + "."
		for i := range ptr.NumMethod() {
			name := ptr.Method(i).Name
			if !isInternalServiceMethod(name) {
				fqns = append(fqns, prefix+name)
			}
		}
	}
	sort.Strings(fqns)
	return fqns, nil
}
