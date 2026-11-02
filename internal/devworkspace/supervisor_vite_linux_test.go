//go:build linux

package devworkspace

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestViteOwnsNodeBehindDelayedShim(t *testing.T) {
	selected, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is required")
	}
	output, err := exec.Command(selected, "-p", "require('node:fs').realpathSync(process.execPath)").Output()
	if err != nil {
		t.Fatal(err)
	}
	actual := strings.TrimSpace(string(output))
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	vite := filepath.Join(root, "node_modules", "vite")
	for _, dir := range []string{bin, vite} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	shim := fmt.Sprintf("#!/bin/sh\n/bin/sleep 0.2\nexec %q \"$@\"\n", actual)
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte(shim), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vite, "package.json"), []byte(`{"name":"vite","bin":"server.js"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vite, "server.js"), []byte(`require('fs').writeFileSync('ready', 'ready'); setInterval(() => {}, 1000)`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, script, err := resolveViteCommand(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if node != actual {
		t.Fatalf("selected %q, want actual executable %q", node, actual)
	}
	owner := devsession.ProcessOwner{WorkspaceID: uuid.NewString(), Generation: "generation", Role: "vite", Source: root}
	child, err := startOwnedChild(ctx, root, os.Environ(), io.Discard, owner, nil, node, script)
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	for {
		if _, err := os.Stat(filepath.Join(root, "ready")); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("Node did not start")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := devsession.VerifyOwnedProcess(child.identity, owner); err != nil {
		t.Fatal(err)
	}
}
