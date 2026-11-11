package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"debug/elf"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func candidateTestRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	return root
}

func writeCandidatePackages(t *testing.T, host string) map[string][]byte {
	t.Helper()
	originals := map[string][]byte{}
	for _, pkg := range candidatePackages {
		filename := filepath.Join(host, "packages", pkg.directory, "package.json")
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			t.Fatal(err)
		}
		raw := []byte("{\"name\":\"" + pkg.name + "\",\"version\":\"0.35.0\",\"exports\":{\".\":\"./dist/index.js\"}}\n")
		if err := os.WriteFile(filename, raw, 0600); err != nil {
			t.Fatal(err)
		}
		originals[filename] = raw
	}
	return originals
}

func TestCandidateStampsOnlyPrivateWorktreeAndRetiresAfterRestore(t *testing.T) {
	ctx := context.Background()
	root := candidateTestRoot(t)
	source := filepath.Join(root, "caller")
	originals := writeCandidatePackages(t, source)
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", source}, args...)...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	git("init")
	git("add", "packages")
	git("-c", "user.name=Candidate test", "-c", "user.email=candidate-test@example.invalid", "commit", "-m", "source")
	collection := filepath.Join(root, "collection")
	if err := os.Mkdir(collection, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := devworkspace.Init(ctx, devworkspace.InitOptions{Root: collection, Sources: []devworkspace.SourceSpec{{ID: "omniview", Path: source, DefaultRef: git("rev-parse", "HEAD")}}}); err != nil {
		t.Fatal(err)
	}
	manager, err := openProfileManager(collection)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := manager.Create(ctx, devworkspace.CreateOptions{Slug: "candidate-stamp"})
	if err != nil {
		t.Fatal(err)
	}
	host, err := workspace.RepositoryPath("omniview")
	if err != nil {
		t.Fatal(err)
	}
	candidate := &candidateOutput{host: host, version: "0.36.0"}
	if err = candidate.prepare(ctx, workspace, candidateCommits{Host: strings.Repeat("0", 40)}); err == nil || !strings.Contains(err.Error(), "omniview checkout does not match its exact requested commit") {
		t.Fatalf("wrong source commit was not rejected before stamping: %v", err)
	}
	if err = candidate.stampPackages(); err != nil {
		t.Fatal(err)
	}
	for filename, before := range originals {
		raw, err := os.ReadFile(filename)
		if err != nil || string(raw) != string(before) {
			t.Fatalf("caller source changed: %s: %v", filename, err)
		}
	}
	for _, stamp := range candidate.stamps {
		raw, err := os.ReadFile(stamp.absolute)
		var manifest struct{ Version string }
		if err != nil || json.Unmarshal(raw, &manifest) != nil || manifest.Version != "0.36.0" || candidateDigest(raw) != stamp.AfterSHA256 || stamp.BeforeSHA256 == stamp.AfterSHA256 {
			t.Fatalf("private version transform not recorded: %+v: %v", stamp, err)
		}
	}
	if err = candidate.restore(); err != nil {
		t.Fatal(err)
	}
	for _, stamp := range candidate.stamps {
		raw, err := os.ReadFile(stamp.absolute)
		if err != nil || string(raw) != string(stamp.original) {
			t.Fatalf("private original not restored: %s: %v", stamp.absolute, err)
		}
	}
	if _, err = manager.Unlink(ctx, workspace.Manifest.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Remove(ctx, workspace.Manifest.WorkspaceID, devworkspace.RemoveOptions{PurgeState: true, DeleteBranches: true}); err != nil {
		t.Fatalf("restored private workspace did not retire safely: %v", err)
	}
}

func TestCandidateStampFailureRestoresPartialWriteSetAndPreservesForeignEdit(t *testing.T) {
	host := candidateTestRoot(t)
	originals := writeCandidatePackages(t, host)
	last := filepath.Join(host, "packages", candidatePackages[2].directory, "package.json")
	if err := os.Remove(last); err != nil {
		t.Fatal(err)
	}
	candidate := &candidateOutput{host: host, version: "0.36.0"}
	if err := candidate.stampPackages(); err == nil || len(candidate.stamps) != 2 {
		t.Fatalf("incomplete stamp unexpectedly succeeded: %v", err)
	}
	if err := candidate.restore(); err != nil {
		t.Fatal(err)
	}
	for _, stamp := range candidate.stamps {
		raw, err := os.ReadFile(stamp.absolute)
		if err != nil || string(raw) != string(originals[stamp.absolute]) {
			t.Fatalf("partial stamp was not restored: %v", err)
		}
	}
	candidate.stamps = nil
	if err := os.WriteFile(last, originals[last], 0600); err != nil {
		t.Fatal(err)
	}
	if err := candidate.stampPackages(); err != nil {
		t.Fatal(err)
	}
	foreign := candidate.stamps[1].absolute
	if err := os.WriteFile(foreign, []byte("foreign edit\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := candidate.restore(); err == nil {
		t.Fatal("foreign edit was silently restored")
	}
	for _, stamp := range candidate.stamps {
		raw, _ := os.ReadFile(stamp.absolute)
		if stamp.absolute == foreign && string(raw) != "foreign edit\n" || stamp.absolute != foreign && string(raw) != string(stamp.stamped) {
			t.Fatal("restore changed files before validating the complete write set")
		}
	}
}

func TestCandidateOutputBoundsAndCompletionGate(t *testing.T) {
	root := candidateTestRoot(t)
	source := filepath.Join(root, "source")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	for name, destination := range map[string]string{"relative": "candidate", "source mutation": filepath.Join(source, "candidate"), "existing output": source} {
		t.Run(name, func(t *testing.T) {
			if _, err := newCandidateOutput(destination, "0.36.0", source); err == nil {
				t.Fatal("unsafe output accepted")
			}
		})
	}
	if _, err := newCandidateOutput(filepath.Join(root, "invalid-version"), "0.36", source); err == nil {
		t.Fatal("non-publication version accepted")
	}
	output := filepath.Join(root, "not-published")
	candidate, err := newCandidateOutput(output, "v0.36.0", source)
	if err != nil {
		t.Fatal(err)
	}
	var resultErr error
	candidate.finish(&resultErr)
	if resultErr == nil {
		t.Fatal("missing producer authorized publication")
	}
	if _, err = os.Lstat(output); !os.IsNotExist(err) {
		t.Fatal("failed candidate exposed output")
	}
	if _, err = os.Lstat(candidate.stage); !os.IsNotExist(err) {
		t.Fatal("owned candidate staging directory leaked")
	}
}

func TestCandidateSDKRequiresVerifiedPublishedTupleToMatchRequestedSource(t *testing.T) {
	commit := strings.Repeat("a", 40)
	sum := "h1:" + strings.Repeat("A", 43) + "="
	published := devsdk.Published{Module: devsdk.Module, Version: "v0.20.0", ModuleSum: sum, GoModSum: sum}
	downloaded := map[string]any{"Path": published.Module, "Version": published.Version, "Sum": sum, "GoModSum": sum, "Origin": map[string]string{"VCS": "git", "Hash": commit}}
	resolve := func(downloaded map[string]any) error {
		return requireCandidateSDKCommit(func(...string) ([]byte, error) {
			return json.Marshal(downloaded)
		}, published, commit)
	}
	if err := resolve(downloaded); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(map[string]any){
		"different tag commit": func(module map[string]any) {
			module["Origin"] = map[string]string{"VCS": "git", "Hash": strings.Repeat("b", 40)}
		},
		"different VCS": func(module map[string]any) {
			module["Origin"] = map[string]string{"VCS": "hg", "Hash": commit}
		},
		"missing origin":    func(module map[string]any) { delete(module, "Origin") },
		"missing checksum":  func(module map[string]any) { delete(module, "Sum") },
		"changed checksum":  func(module map[string]any) { module["Sum"] = "h1:" + strings.Repeat("B", 43) + "=" },
		"different version": func(module map[string]any) { module["Version"] = "v0.19.0" },
		"different module":  func(module map[string]any) { module["Path"] = "example.invalid/sdk" },
	} {
		t.Run(name, func(t *testing.T) {
			copy := map[string]any{}
			for key, value := range downloaded {
				copy[key] = value
			}
			change(copy)
			if err := resolve(copy); err == nil {
				t.Fatal("changed published tuple or mismatched SDK source accepted")
			}
		})
	}
	t.Run("cached origin", func(t *testing.T) {
		filename := filepath.Join(candidateTestRoot(t), "sdk.info")
		info, err := json.Marshal(map[string]any{"Version": published.Version, "Origin": downloaded["Origin"]})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filename, info, 0600); err != nil {
			t.Fatal(err)
		}
		copy := map[string]any{}
		for key, value := range downloaded {
			copy[key] = value
		}
		delete(copy, "Origin")
		copy["Info"] = filename
		if err = resolve(copy); err != nil {
			t.Fatal(err)
		}
	})
}

func writeCandidateTestArchive(t *testing.T, filename string, backend []byte) {
	t.Helper()
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	writer := tar.NewWriter(gzipWriter)
	for _, entry := range []struct {
		name string
		data []byte
	}{{"plugin.yaml", []byte("id: kubernetes\n")}, {"assets/entry.js", []byte("System.register([], function() {})\n")}, {"bin/plugin", backend}} {
		if err = writer.WriteHeader(&tar.Header{Name: entry.name, Mode: 0600, Size: int64(len(entry.data)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err = writer.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err = errors.Join(writer.Close(), gzipWriter.Close(), file.Close()); err != nil {
		t.Fatal(err)
	}
}

func TestCandidateTransportChecksCanonicalDigestActualPlatformAndBounds(t *testing.T) {
	root := candidateTestRoot(t)
	backend := make([]byte, 20)
	copy(backend, elf.ELFMAG)
	backend[4], backend[5] = byte(elf.ELFCLASS64), byte(elf.ELFDATA2LSB)
	binary.LittleEndian.PutUint16(backend[18:20], uint16(elf.EM_X86_64))
	archive := filepath.Join(root, "canonical.tar.gz")
	writeCandidateTestArchive(t, archive, backend)
	if err := requireCandidatePlatform(archive); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if err = copyCandidateArchive(archive, filepath.Join(root, "copy.tar.gz"), candidateDigest(raw)); err != nil {
		t.Fatal(err)
	}
	if err = copyCandidateArchive(archive, filepath.Join(root, "wrong.tar.gz"), strings.Repeat("0", 64)); err == nil {
		t.Fatal("changed archive bytes accepted")
	}
	backend[18] = byte(elf.EM_AARCH64)
	writeCandidateTestArchive(t, archive, backend)
	if err = requireCandidatePlatform(archive); err == nil {
		t.Fatal("wrong advertised platform accepted")
	}
	if err = os.Truncate(archive, candidateArchiveLimit+1); err != nil {
		t.Fatal(err)
	}
	if err = copyCandidateArchive(archive, filepath.Join(root, "huge.tar.gz"), strings.Repeat("0", 64)); err == nil {
		t.Fatal("oversized sparse archive accepted")
	}
	redirect := filepath.Join(root, "redirect.tar.gz")
	if err = os.Symlink(archive, redirect); err != nil {
		t.Fatal(err)
	}
	if err = copyCandidateArchive(redirect, filepath.Join(root, "redirect-copy.tar.gz"), strings.Repeat("0", 64)); err == nil {
		t.Fatal("redirected archive accepted")
	}
}

func TestCandidateReceiptPublishesOnlyAfterOwnedRestore(t *testing.T) {
	for _, test := range []struct {
		name        string
		foreignEdit bool
	}{{"clean", false}, {"foreign-edit", true}} {
		t.Run(test.name, func(t *testing.T) {
			root := candidateTestRoot(t)
			host := filepath.Join(root, "private-host")
			writeCandidatePackages(t, host)
			output := filepath.Join(root, "archives")
			candidate, err := newCandidateOutput(output, "0.36.0", host)
			if err != nil {
				t.Fatal(err)
			}
			candidate.host = host
			candidate.commits = candidateCommits{Host: strings.Repeat("a", 40), SDK: strings.Repeat("b", 40), Kubernetes: strings.Repeat("c", 40)}
			sum := "h1:" + strings.Repeat("A", 43) + "="
			candidate.sdk = devsdk.Published{Module: devsdk.Module, Version: "v0.20.0", ModuleSum: sum, GoModSum: sum}
			if err = candidate.stampPackages(); err != nil {
				t.Fatal(err)
			}
			backend := make([]byte, 20)
			copy(backend, elf.ELFMAG)
			backend[4], backend[5] = byte(elf.ELFCLASS64), byte(elf.ELFDATA2LSB)
			binary.LittleEndian.PutUint16(backend[18:20], uint16(elf.EM_X86_64))
			archive := filepath.Join(root, "canonical.tar.gz")
			writeCandidateTestArchive(t, archive, backend)
			raw, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			receipt := devworkspace.ArchivePluginStatus{Archive: archive, ArchiveSHA256: candidateDigest(raw), BackendSHA256: candidateDigest(backend), AssetFiles: 1}
			evidence := []byte(`{"protocol":"workspace","versions":["12.14.0"],"atomicDist":true,"peers":true,"runtime":true}`)
			if err = candidate.record(receipt, evidence); err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(output); !os.IsNotExist(err) {
				t.Fatal("candidate became public before cleanup")
			}
			if test.foreignEdit {
				if err = os.WriteFile(candidate.stamps[0].absolute, []byte("foreign edit\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			resultErr := candidate.restore()
			candidate.finish(&resultErr)
			if test.foreignEdit {
				if resultErr == nil {
					t.Fatal("failed owned restore authorized publication")
				}
				if _, err = os.Lstat(output); !os.IsNotExist(err) {
					t.Fatal("failed cleanup exposed completed output")
				}
				if _, err = os.Lstat(candidate.stage); !os.IsNotExist(err) {
					t.Fatal("failed cleanup leaked owned candidate staging")
				}
				return
			}
			if resultErr != nil {
				t.Fatal(resultErr)
			}
			raw, err = os.ReadFile(filepath.Join(output, candidateArchiveName))
			if err != nil || candidateDigest(raw) != receipt.ArchiveSHA256 {
				t.Fatalf("transport changed canonical archive bytes: %v", err)
			}
			var proof candidateReceipt
			raw, err = os.ReadFile(filepath.Join(output, "candidate.json"))
			if err != nil || json.Unmarshal(raw, &proof) != nil {
				t.Fatalf("missing completed candidate receipt: %v", err)
			}
			if proof.Archive != candidateArchiveName || proof.BackendSHA256 != receipt.BackendSHA256 || proof.AssetFiles != receipt.AssetFiles || proof.Commits != candidate.commits || proof.SDK != candidate.sdk || proof.NPMVersion != "0.36.0" || proof.LinkEvidenceSHA256 != candidateDigest(evidence) || len(proof.Packages) != 3 {
				t.Fatalf("canonical/source/transform evidence changed during export: %+v", proof)
			}
		})
	}
}
