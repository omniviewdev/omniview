package devoutputs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicationRecordRejectsIllegalOperationPhases(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	err = locked(context.Background(), stage.s, func(j *journal) error {
		entry := j.Entries[stage.key]
		for _, combination := range []struct {
			phase           string
			restore, remove bool
		}{
			{"writing", true, false},
			{"restoring", false, false},
			{"restore-allocating", false, false},
			{"allocating", true, false},
			{"aborting", true, false},
			{"captured", false, true},
			{"restoring", true, true},
		} {
			entry.Pending.Phase = combination.phase
			entry.Pending.Restore = combination.restore
			entry.Pending.Remove = combination.remove
			if validationErr := validateEntryRecord(entry); validationErr == nil {
				t.Errorf("accepted illegal publication phase=%s restore=%t remove=%t", combination.phase, combination.restore, combination.remove)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// These are real interrupted rename boundaries, not synthetic journal-only
// transitions. Inspection must never rename, delete or rewrite the journal.
func TestPublicationInspectionRevalidatesBeforeMutation(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "index.js"), "generated")
	err = locked(context.Background(), stage.s, func(j *journal) error {
		entry := j.Entries[stage.key]
		entry.Pending.After, err = snapshotPath(stageSpec(entry), nil)
		if err != nil {
			return err
		}
		container := entry.Spec
		container.Target = entry.Pending.Directory
		entry.Pending.Container, err = snapshotPath(container, nil)
		if err != nil {
			return err
		}
		entry.Pending.Phase = "captured"
		if err = save(stage.s, j); err != nil {
			return err
		}
		before, err := json.Marshal(j)
		if err != nil {
			return err
		}
		if err = validatePending(context.Background(), entry); err != nil {
			return err
		}
		after, err := json.Marshal(j)
		if err != nil {
			return err
		}
		if string(before) != string(after) {
			t.Fatal("read-only inspection mutated journal")
		}
		if _, err = os.Lstat(entry.Pending.Backup); !os.IsNotExist(err) {
			t.Fatalf("inspection created backup: %v", err)
		}
		foreign := filepath.Join(entry.Spec.Target, "foreign.txt")
		writeOutput(t, foreign, "user bytes after preflight")
		if err = completePublication(context.Background(), stage.s, j, stage.key); err == nil {
			t.Fatal("execution trusted stale preflight")
		}
		raw, err := os.ReadFile(foreign)
		if err != nil || string(raw) != "user bytes after preflight" {
			t.Fatalf("execution changed foreign bytes: %s %v", raw, err)
		}
		if _, err = os.Lstat(entry.Pending.Backup); !os.IsNotExist(err) {
			t.Fatalf("execution renamed destination after stale preflight: %v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPublicationPreflightRejectsOccupiedBackupBeforeAnyRename(t *testing.T) {
	w, repo := outputFixture(t)
	stage, err := Prepare(context.Background(), w, repo, YAMLWorker)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(stage.Directory, "yaml.worker.bundle.js"), "generated worker")
	err = locked(context.Background(), stage.s, func(j *journal) error {
		entry := j.Entries[stage.key]
		entry.Pending.After, err = snapshotPath(stageSpec(entry), nil)
		if err != nil {
			return err
		}
		container := entry.Spec
		container.Mode = "tree"
		container.Target = entry.Pending.Directory
		entry.Pending.Container, err = snapshotPath(container, nil)
		if err != nil {
			return err
		}
		entry.Pending.Phase = "captured"
		original, err := os.ReadFile(entry.Spec.Target)
		if err != nil {
			return err
		}
		writeOutput(t, entry.Pending.Backup, string(original))
		if err = validatePending(context.Background(), entry); err == nil {
			t.Fatal("preflight authorized an occupied backup that execution cannot use")
		}
		current, err := os.ReadFile(entry.Spec.Target)
		if err != nil || string(current) != string(original) {
			t.Fatalf("preflight changed original output: %s %v", current, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPublicationStatePreservesLegacyEncoding(t *testing.T) {
	for state := producerAllocating; state <= removalPublished; state++ {
		var p publication
		p.setState(state)
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		var wire struct {
			Phase           string
			Restore, Remove bool
		}
		if err = json.Unmarshal(raw, &wire); err != nil {
			t.Fatal(err)
		}
		if wire.Phase == "" || wire.Restore != (state.operation() != produceOutput) || wire.Remove != (state.operation() == removeOutput) {
			t.Fatalf("state %d lost legacy wire fields: %s", state, raw)
		}
		var decoded publication
		if err = json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		actual, err := decoded.state()
		if err != nil || actual != state {
			t.Fatalf("state %d roundtrip: %d %v", state, actual, err)
		}
	}
}

func TestPublicationDecisionsFollowFilesystemEvidenceAcrossUnsavedRenames(t *testing.T) {
	for _, kind := range []Producer{Distribution, YAMLWorker} {
		t.Run(string(kind), func(t *testing.T) {
			w, repo := outputFixture(t)
			stage, err := Prepare(context.Background(), w, repo, kind)
			if err != nil {
				t.Fatal(err)
			}
			leaf := "index.js"
			if kind == YAMLWorker {
				leaf = "yaml.worker.bundle.js"
			}
			writeOutput(t, filepath.Join(stage.Directory, leaf), "generated output")
			err = locked(context.Background(), stage.s, func(j *journal) error {
				entry := j.Entries[stage.key]
				p := entry.Pending
				p.After, err = snapshotPath(stageSpec(entry), nil)
				if err != nil {
					return err
				}
				container := entry.Spec
				container.Mode = "tree"
				container.Target = p.Directory
				p.Container, err = snapshotPath(container, nil)
				if err != nil {
					return err
				}
				p.setState(producerCaptured)
				if err = save(stage.s, j); err != nil {
					return err
				}
				assertAction := func(want publicationAction) {
					t.Helper()
					inspection, inspectErr := inspectPublication(context.Background(), entry)
					if inspectErr != nil || inspection.action != want {
						t.Fatalf("action = %d, want %d: %v", inspection.action, want, inspectErr)
					}
				}
				assertAction(backupDestination)
				// Interruption between rename and journal save: the captured
				// phase remains, but only publication is now authorized.
				if err = os.Rename(entry.Spec.Target, p.Backup); err != nil {
					return err
				}
				assertAction(publishCapturedStage)
				source := p.Directory
				if entry.Spec.Mode == "file" {
					source = filepath.Join(source, filepath.Base(entry.Spec.Target))
				}
				if err = os.Rename(source, entry.Spec.Target); err != nil {
					return err
				}
				assertAction(recordPublication)
				if err = completePublication(context.Background(), stage.s, j, stage.key); err != nil {
					return err
				}
				target := entry.Spec.Target
				if entry.Spec.Mode != "file" {
					target = filepath.Join(target, leaf)
				}
				raw, err := os.ReadFile(target)
				if err != nil || string(raw) != "generated output" {
					t.Fatalf("recovery lost captured output: %s %v", raw, err)
				}
				if _, err = os.Lstat(p.Backup); !os.IsNotExist(err) {
					t.Fatalf("recovery retained backup: %v", err)
				}
				if entry.Pending != nil {
					t.Fatal("recovery retained completed publication")
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPublishPreflightsEveryCapturedDestination(t *testing.T) {
	w, repo := outputFixture(t)
	dist, err := Prepare(context.Background(), w, repo, Distribution)
	if err != nil {
		t.Fatal(err)
	}
	worker, err := Prepare(context.Background(), w, repo, YAMLWorker)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(dist.Directory, "index.js"), "generated distribution")
	writeOutput(t, filepath.Join(worker.Directory, "yaml.worker.bundle.js"), "generated worker")
	err = locked(context.Background(), worker.s, func(j *journal) error {
		entry := j.Entries[worker.key]
		original, err := os.ReadFile(entry.Spec.Target)
		if err != nil {
			return err
		}
		writeOutput(t, entry.Pending.Backup, string(original))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = Publish(context.Background(), dist, worker); err == nil {
		t.Fatal("publication ignored occupied backup in later destination")
	}
	if _, err = os.Lstat(filepath.Join(repo, "dist/index.js")); !os.IsNotExist(err) {
		t.Fatalf("earlier destination mutated before complete preflight: %v", err)
	}
	if _, err = os.Lstat(filepath.Join(dist.Directory, "index.js")); err != nil {
		t.Fatalf("earlier captured stage changed before complete preflight: %v", err)
	}
}

func TestInterruptedRemovalRetainsLegacyProgressStates(t *testing.T) {
	for _, phase := range []string{"captured", "backed-up", "published"} {
		t.Run(phase, func(t *testing.T) {
			for _, progress := range []string{"complete backup", "partial backup", "edited partial backup", "foreign partial backup"} {
				t.Run(progress, func(t *testing.T) {
					w, repo := outputFixture(t)
					outputGit(t, repo, "rm", "dist/.gitkeep")
					outputCommit(t, repo, "no tracked distribution")
					stage, err := Prepare(context.Background(), w, repo, Distribution)
					if err != nil {
						t.Fatal(err)
					}
					const original = "generated distribution"
					writeOutput(t, filepath.Join(stage.Directory, "index.js"), original)
					writeOutput(t, filepath.Join(stage.Directory, "removed.js"), "owned partial cleanup")
					if err = Publish(context.Background(), stage); err != nil {
						t.Fatal(err)
					}
					var backup string
					err = locked(context.Background(), stage.s, func(j *journal) error {
						entry := j.Entries[stage.key]
						before, err := snapshotPath(entry.Spec, nil)
						if err != nil {
							return err
						}
						revision, err := specHead(context.Background(), entry.Spec)
						if err != nil {
							return err
						}
						j.Restoring = true
						if err = allocateRemoval(stage.s, j, entry, revision, before); err != nil {
							return err
						}
						backup = entry.Pending.Backup
						if err = os.Rename(entry.Spec.Target, backup); err != nil {
							return err
						}
						if phase == "captured" {
							// The rename happened but its next checkpoint did not.
							return nil
						}
						entry.Pending.Phase = phase
						return save(stage.s, j)
					})
					if err != nil {
						t.Fatal(err)
					}
					if progress != "complete backup" {
						if err = os.Remove(filepath.Join(backup, "removed.js")); err != nil {
							t.Fatal(err)
						}
					}
					remaining := filepath.Join(backup, "index.js")
					want := original
					switch progress {
					case "edited partial backup":
						before, err := os.Stat(remaining)
						if err != nil {
							t.Fatal(err)
						}
						want = strings.Repeat("x", len(original))
						writeOutput(t, remaining, want)
						if err = os.Chtimes(remaining, before.ModTime(), before.ModTime()); err != nil {
							t.Fatal(err)
						}
						after, err := os.Stat(remaining)
						if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
							t.Fatal("foreign edit did not preserve size/mtime", err)
						}
					case "foreign partial backup":
						writeOutput(t, filepath.Join(backup, "human.js"), "foreign bytes")
					}
					err = Restore(context.Background(), w)
					if progress == "edited partial backup" || progress == "foreign partial backup" {
						if err == nil {
							t.Fatal("interrupted removal accepted foreign bytes")
						}
						if data, err := os.ReadFile(remaining); err != nil || string(data) != want {
							t.Fatal("refusal changed the remaining backup", err)
						}
						if progress == "foreign partial backup" {
							if data, err := os.ReadFile(filepath.Join(backup, "human.js")); err != nil || string(data) != "foreign bytes" {
								t.Fatal("refusal changed unknown bytes", err)
							}
						}
						persisted, err := readJournal(stage.s)
						if err != nil || !persisted.Restoring || persisted.Entries[stage.key] == nil {
							t.Fatal("foreign removal released pending ownership", err)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					if _, err = os.Lstat(filepath.Join(repo, "dist")); !os.IsNotExist(err) {
						t.Fatalf("interrupted removal left generated output: %v", err)
					}
					if _, err = os.Lstat(backup); !os.IsNotExist(err) {
						t.Fatalf("interrupted removal left its known backup: %v", err)
					}
					if _, err = os.Lstat(stage.s.path); !os.IsNotExist(err) {
						t.Fatalf("interrupted removal left journal: %v", err)
					}
				})
			}
		})
	}
}

func TestRemovalLeavesRehashEditsAfterWholeTreeAdmission(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "payload.js")
	writeOutput(t, path, "owned bytes")
	spec := specification{Target: root, Kind: Distribution, Mode: "tree"}
	expected, err := snapshotPath(spec, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, path, "human bytes")
	if err = os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err = removeSnapshotLeaves(spec, expected); err == nil {
		t.Fatal("leaf removal reused an earlier digest")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "human bytes" {
		t.Fatal("leaf removal changed later user bytes", err)
	}
}
