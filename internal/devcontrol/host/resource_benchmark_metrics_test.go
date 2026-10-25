//go:build devcontrol

package host

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func metricFixture(t *testing.T) (string, devcontract.InstanceDescriptor) {
	t.Helper()
	// Keep Darwin sockaddr paths short; this directory is created exclusively.
	root, err := os.MkdirTemp("", "p02-m-")
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(canonical); err != nil {
			t.Error(err)
		}
	})
	descriptor := devcontract.InstanceDescriptor{Kind: "development", WorkspaceID: "test-workspace", Generation: "generation", StateRoot: "/private/test-state", Process: devcontract.ProcessIdentity{PID: os.Getpid(), WorkspaceID: "test-workspace", Generation: "generation", Role: "host", Source: "/source"}}
	return filepath.Join(canonical, "metrics.sock"), descriptor
}
func TestResourceBenchmarkSnapshotAndOwnedSocketCleanup(t *testing.T) {
	path, descriptor := metricFixture(t)
	sampler, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	defer sampler.Close()
	conn, err := net.Dial("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(time.Second))
	if err := json.NewEncoder(conn).Encode(resourceBenchmarkRequest{Operation: "gc-snapshot", WorkspaceID: descriptor.WorkspaceID, Generation: descriptor.Generation}); err != nil {
		t.Fatal(err)
	}
	var sample resourceBenchmarkSnapshot
	if err := json.NewDecoder(conn).Decode(&sample); err != nil {
		t.Fatal(err)
	}
	if sample.WorkspaceID != descriptor.WorkspaceID || sample.Process.PID != os.Getpid() || !sample.ForcedGC || sample.HeapObjects == 0 || sample.HeapAlloc == 0 {
		t.Fatalf("wrong real heap sample: %+v", sample)
	}
	if err := sampler.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("owned socket survived close: %v", err)
	}
}
func TestResourceBenchmarkRejectsForeignOrPublicPath(t *testing.T) {
	path, descriptor := metricFixture(t)
	if err := os.WriteFile(path, []byte("foreign"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor); err == nil {
		t.Fatal("adopted existing leaf")
	}
	bytes, err := os.ReadFile(path)
	if err != nil || string(bytes) != "foreign" {
		t.Fatal("changed foreign leaf")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor); err == nil {
		t.Fatal("accepted public parent")
	}
}
func TestResourceBenchmarkCleanupPreservesReplacement(t *testing.T) {
	path, descriptor := metricFixture(t)
	sampler, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := sampler.Close(); err == nil {
		t.Fatal("replacement cleanup should refuse")
	}
	bytes, err := os.ReadFile(path)
	if err != nil || string(bytes) != "replacement" {
		t.Fatal("deleted replacement")
	}
}

func TestResourceBenchmarkRejectsStaleIdentityAndBoundedRequests(t *testing.T) {
	path, descriptor := metricFixture(t)
	sampler, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	defer sampler.Close()
	for _, request := range []string{
		"{\"operation\":\"gc-snapshot\",\"workspaceID\":\"other\",\"generation\":\"generation\"}\n",
		"{\"operation\":\"unknown\",\"workspaceID\":\"test-workspace\",\"generation\":\"generation\"}\n",
		"{\"operation\":\"snapshot\",\"workspaceID\":\"test-workspace\",\"generation\":\"generation\",\"unknown\":true}\n",
		"{\"operation\":\"snapshot\",\"workspaceID\":\"test-workspace\",\"generation\":\"generation\"} {}\n",
		string(make([]byte, 300)) + "\n",
	} {
		conn, err := net.Dial("unix", path)
		if err != nil {
			t.Fatal(err)
		}
		conn.SetDeadline(time.Now().Add(2 * time.Second))
		if _, err := conn.Write([]byte(request)); err != nil {
			t.Fatal(err)
		}
		var sample resourceBenchmarkSnapshot
		err = json.NewDecoder(conn).Decode(&sample)
		conn.Close()
		if err == nil {
			t.Fatalf("invalid request received metrics: %q", request)
		}
	}
}

func TestResourceBenchmarkContextCancellationClosesSocket(t *testing.T) {
	path, descriptor := metricFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	sampler, err := startResourceBenchmarkMetrics(ctx, path, descriptor)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	if err := sampler.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("socket survived cancellation: %v", err)
	}
}

func TestResourceBenchmarkRefusesRedirectedParentAndWrongHost(t *testing.T) {
	path, descriptor := metricFixture(t)
	alias := filepath.Dir(path) + "-alias"
	if err := os.Symlink(filepath.Dir(path), alias); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(alias)
	if _, err := startResourceBenchmarkMetrics(context.Background(), filepath.Join(alias, "metrics.sock"), descriptor); err == nil {
		t.Fatal("followed symlink parent")
	}
	descriptor.Kind = "production"
	if _, err := startResourceBenchmarkMetrics(context.Background(), path, descriptor); err == nil {
		t.Fatal("enabled production measurement control")
	}
}
