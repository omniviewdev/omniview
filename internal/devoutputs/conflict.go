package devoutputs

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Conflict describes one exact producer boundary. It never grants permission to
// delete, adopt, or overwrite bytes, and never attributes changes to a process.
type Conflict struct {
	Code           string       `json:"code"`
	Producer       Producer     `json:"producer"`
	Consumer       string       `json:"consumer"`
	Target         string       `json:"target"`
	Ownership      string       `json:"ownership"`
	Phase          string       `json:"phase"`
	MetadataPath   string       `json:"metadataPath,omitempty"`
	Stage          string       `json:"stage,omitempty"`
	Backup         string       `json:"backup,omitempty"`
	ChangedPaths   []string     `json:"changedPaths,omitempty"`
	MoreChanges    bool         `json:"moreChanges,omitempty"`
	Differences    []Difference `json:"differences,omitempty"`
	LifecyclePhase string       `json:"lifecyclePhase,omitempty"`
	NextCommands   [][]string   `json:"nextCommands,omitempty"`
	Guidance       string       `json:"guidance"`
	cause          error
}

// Difference exposes file kinds, not hashes, contents, or writer attribution.
type Difference struct {
	Path         string `json:"path"`
	ActualKind   string `json:"actualKind"`
	ExpectedKind string `json:"expectedKind"`
}

func (c *Conflict) Error() string {
	detail := ""
	if c.cause != nil {
		detail = ": " + c.cause.Error()
	}
	return fmt.Sprintf("%s: %s producer %s at %s (%s, %s)%s; %s", c.Code, c.Producer, c.Consumer, c.Target, c.Ownership, c.Phase, detail, c.Guidance)
}
func (c *Conflict) Unwrap() error { return c.cause }

func conflict(spec specification, ownership, phase string, actual, expected snapshot, cause error) *Conflict {
	c := &Conflict{Code: "ownership_conflict", Producer: spec.Kind, Consumer: spec.Consumer, Target: spec.Target, Ownership: ownership, Phase: phase, cause: cause,
		Guidance: "Preserve these bytes before reconciliation. Do not adopt or delete unknown files. Inspect with workspace ownership. Stop with workspace down before any managed repair."}
	if spec.Kind == modules || spec.Kind == viteCache || spec.Kind == loaderCache || spec.Kind == typeCache {
		c.Guidance += " workspace reset-modules is destructive and requires explicit authorization for all selected dependency trees; it leaves source, profiles and producer outputs untouched."
	} else if ownership == "owned" {
		c.Guidance += " Use workspace reconcile-output with an exact producer and an external preservation path, then regenerate through the managed producer."
	} else {
		c.Guidance += " No automatic repair is authorized for unowned outputs. Preserve them externally and restore the exact committed baseline before retrying."
	}
	if actual == nil {
		var substitution *pathConflict
		if errors.As(cause, &substitution) {
			c.ChangedPaths = []string{substitution.Path}
			c.Differences = []Difference{{Path: substitution.Path, ActualKind: substitution.ActualKind, ExpectedKind: substitution.ExpectedKind}}
		}
		return c
	}
	paths := map[string]bool{}
	for p, v := range actual {
		if expected[p] != v {
			paths[p] = true
		}
	}
	for p, v := range expected {
		if v.Kind != "absent" && actual[p] != v {
			paths[p] = true
		}
	}
	names := make([]string, 0, len(paths))
	for p := range paths {
		names = append(names, p)
	}
	sort.Slice(names, func(i, j int) bool {
		left, right := actual[names[i]].Kind == "directory" || names[i] == ".", actual[names[j]].Kind == "directory" || names[j] == "."
		if left != right {
			return !left
		}
		return names[i] < names[j]
	})
	c.MoreChanges = len(names) > 12
	if len(names) > 12 {
		names = names[:12]
	}
	for _, p := range names {
		path := filepath.Join(spec.Target, p)
		c.ChangedPaths = append(c.ChangedPaths, path)
		a, e := actual[p].Kind, expected[p].Kind
		if a == "" {
			a = "absent"
		}
		if e == "" {
			e = "absent"
		}
		c.Differences = append(c.Differences, Difference{Path: path, ActualKind: a, ExpectedKind: e})
	}
	return c
}
func entryConflict(entry *outputEntry, phase string, actual snapshot, cause error) *Conflict {
	c := conflict(entry.Spec, "owned", phase, actual, physical(entry.Expected), cause)
	if entry.Pending != nil {
		c.Stage = entry.Pending.Directory
		c.Backup = entry.Pending.Backup
		c.Phase = "publication:" + entry.Pending.Phase
	}
	return c
}
func decorateConflict(s scope, err error) error {
	if c, ok := err.(*Conflict); ok {
		c.MetadataPath = s.path
	}
	return err
}

func producerKind(value string) (Producer, error) {
	p := Producer(strings.TrimSpace(value))
	switch p {
	case Distribution, Bindings, Shims, YAMLWorker:
		return p, nil
	}
	return "", fmt.Errorf("unsupported staged producer: %s", value)
}
