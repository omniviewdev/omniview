package devoutputs

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

func validateSnapshotPaths(spec specification, values snapshot) error {
	for relative, value := range values {
		if relative != "." && (!filepath.IsLocal(relative) || filepath.Clean(relative) != relative || strings.Contains(relative, "\\") && filepath.Separator != '\\') {
			return fmt.Errorf("journal snapshot escapes its producer boundary")
		}
		for _, part := range strings.Split(filepath.ToSlash(relative), "/") {
			if part == ".git" {
				return fmt.Errorf("journal snapshot contains Git metadata")
			}
		}
		if spec.Mode == "file" && relative != "." {
			return fmt.Errorf("file producer snapshot contains another path")
		}
		if spec.Mode == "filter" && relative != "." && (filepath.Dir(relative) != "." || !IsViteConfigTemporaryFile(relative)) {
			return fmt.Errorf("loader journal contains a non-loader path")
		}
		switch value.Kind {
		case "file", "directory", "absent":
		case "link":
			if spec.Kind != modules {
				return fmt.Errorf("source producer journal contains a link")
			}
		default:
			return fmt.Errorf("journal snapshot contains an unsupported file type")
		}
	}
	return nil
}
func validateEntryRecord(entry *outputEntry) error {
	if entry == nil {
		return fmt.Errorf("nil output journal entry")
	}
	for _, values := range []snapshot{entry.Expected, entry.Original} {
		if err := validateSnapshotPaths(entry.Spec, values); err != nil {
			return err
		}
	}
	if p := entry.Pending; p != nil {
		id, err := uuid.Parse(p.Token)
		if err != nil || id == uuid.Nil || id.String() != p.Token {
			return fmt.Errorf("invalid producer capability token")
		}
		parent := filepath.Dir(entry.Spec.Target)
		if p.Directory != filepath.Join(parent, ".omniview-output-"+p.Token) || p.Backup != filepath.Join(backupDirectory(entry.Spec), ".omniview-before-"+p.Token) {
			return fmt.Errorf("producer stage/backup escapes its exact selected boundary")
		}
		state, err := p.state()
		if err != nil {
			return err
		}
		for _, values := range []snapshot{p.Before, p.After} {
			if state == producerAborting {
				break
			}
			if err = validateSnapshotPaths(entry.Spec, values); err != nil {
				return err
			}
		}
		container := entry.Spec
		container.Mode = "tree"
		if err = validateSnapshotPaths(container, p.Container); err != nil {
			return err
		}
		if state == producerAborting {
			if err = validateSnapshotPaths(container, p.After); err != nil {
				return err
			}
		}
	}
	if entry.Cleanup != nil {
		for _, values := range []snapshot{entry.Cleanup.Remove, entry.Cleanup.Retain} {
			if err := validateSnapshotPaths(entry.Spec, values); err != nil {
				return err
			}
		}
	}
	return nil
}
