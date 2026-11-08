package devsdk

import (
	"debug/buildinfo"
	"errors"
	"fmt"
	"runtime/debug"
)

// VerifyBinary checks the Go build information of a built executable against
// the SDK identity its build was verified under. Every identity requires the
// SDK module to be part of the binary. A published identity additionally
// requires exactly the verified version and module checksum and no replacement.
// A source identity keeps its stronger path binding in the callers' before and
// after source observations: the compiled build information of a replaced
// module names only the replacement.
//
// The build information proves which module the Go command selected, not that
// the executable's bytes were compiled from it; the trusted builder's before
// and after verification brackets that gap.
func VerifyBinary(consumer, binary string, identity Identity) error {
	if err := identity.Validate(); err != nil {
		return err
	}
	info, err := buildinfo.ReadFile(binary)
	if err != nil {
		return fmt.Errorf("built binary has no inspectable Go module identity: %w", err)
	}
	var included *debug.Module
	for _, dependency := range info.Deps {
		if dependency.Path == Module {
			included = dependency
			break
		}
	}
	if included == nil {
		return errors.New("built binary does not include the selected SDK module")
	}
	published, isPublished := identity.Published()
	if !isPublished {
		return nil
	}
	if included.Replace != nil {
		return selectionConflict(consumer, published, fmt.Sprintf("the %s binary was built with a replacement of %s", consumer, Module))
	}
	if included.Version != published.Version || included.Sum != published.ModuleSum {
		return IdentityChanged(consumer, fmt.Sprintf(
			"the %s binary was built against %s %s (%s), not the verified %s", consumer, Module, included.Version, included.Sum, published.Version))
	}
	return nil
}
