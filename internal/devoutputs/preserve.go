package devoutputs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type preservationParents struct {
	source, destination                 *os.File
	sourcePath, destinationPath         string
	sourceIdentity, destinationIdentity string
}

func pinPreservationParents(source, destination, sourceIdentity, destinationIdentity string) (preservationParents, error) {
	p := preservationParents{sourcePath: filepath.Dir(source), destinationPath: filepath.Dir(destination), sourceIdentity: sourceIdentity, destinationIdentity: destinationIdentity}
	var err error
	p.source, err = pinDirectory(p.sourcePath, sourceIdentity)
	if err != nil {
		return p, err
	}
	p.destination, err = pinDirectory(p.destinationPath, destinationIdentity)
	if err != nil {
		p.source.Close()
		p.source = nil
		return p, err
	}
	return p, nil
}
func (p *preservationParents) close() {
	if p.source != nil {
		p.source.Close()
	}
	if p.destination != nil {
		p.destination.Close()
	}
}
func (p *preservationParents) move(sourceName, destinationName string) error {
	for _, name := range []string{sourceName, destinationName} {
		if !filepath.IsLocal(name) || filepath.Base(name) != name || name == "." || strings.ContainsAny(name, ":\x00") {
			return fmt.Errorf("invalid preservation leaf name")
		}
	}
	// Both names are relative to retained, identity-checked parent handles. There
	// is deliberately no pathname rename or check-then-use fallback.
	if err := renamePinnedNoReplace(p.source, sourceName, p.destination, destinationName); err != nil {
		return err
	}
	// A namespace replacement cannot redirect the move. Refuse further pathname
	// observations if either name no longer denotes its pinned parent.
	actual, err := directoryIdentity(p.sourcePath)
	if err != nil {
		return err
	}
	if actual != p.sourceIdentity {
		return fmt.Errorf("source parent namespace changed during preservation")
	}
	return validatePreservationParent(p.destinationPath, p.destinationIdentity)
}
func preserveRename(source, destination, sourceIdentity, destinationIdentity string) error {
	parents, err := pinPreservationParents(source, destination, sourceIdentity, destinationIdentity)
	if err != nil {
		return err
	}
	defer parents.close()
	return parents.move(filepath.Base(source), filepath.Base(destination))
}
