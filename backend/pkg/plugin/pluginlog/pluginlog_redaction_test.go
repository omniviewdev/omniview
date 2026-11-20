package pluginlog

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A plugin's stderr is plugin-authored text: an upstream error that echoes a
// request header, a debug line that prints its configuration. Stream.Write is
// the only place that text enters the host, so it is where credentials have to
// go. Everything downstream of it (the rotated file, the ring buffer the UI
// reads with GetLogs and SearchLogs, the live event and the OTel shipping sink)
// is fed from the same bytes.

const (
	leakedBearer   = "Authorization: Bearer abc123def456ghi789"
	leakedPassword = "password=hunter2"
	leakedKeyID    = "AKIAIOSFODNN7EXAMPLE"
)

func leakedValues() []string { return []string{"abc123def456ghi789", "hunter2", leakedKeyID} }

func leakingLine() string {
	return "2024-01-15T10:30:00.000Z [ERROR] alpha: request failed: " +
		leakedBearer + " ; " + leakedPassword + " ; " + leakedKeyID + "\n"
}

func requireNoLeak(t *testing.T, where, text string) {
	t.Helper()
	for _, secret := range leakedValues() {
		if i := strings.Index(text, secret); i >= 0 {
			t.Errorf("%s carries %q verbatim: ...%s...", where, secret, text[max(0, i-40):min(len(text), i+len(secret)+40)])
		}
	}
}

func TestStreamRedactsCredentialsBeforeEverySink(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	var emitted, shipped []LogEntry
	mgr.OnEmit(func(e LogEntry) { emitted = append(emitted, e) })
	mgr.OnRemote(func(e LogEntry) { shipped = append(shipped, e) })
	mgr.Subscribe("alpha")

	line := leakingLine()
	n, err := mgr.Stream("alpha").Write([]byte(line))
	if err != nil || n != len(line) {
		t.Fatalf("Write = (%d, %v), want (%d, nil): the caller handed over %d bytes", n, err, len(line), len(line))
	}

	raw, err := os.ReadFile(filepath.Join(dir, "plugin.alpha.log"))
	if err != nil {
		t.Fatal(err)
	}
	requireNoLeak(t, "plugin.alpha.log", string(raw))

	buffered := mgr.GetLogs("alpha", 0)
	if len(buffered) != 1 || len(emitted) != 1 || len(shipped) != 1 {
		t.Fatalf("one line must reach the buffer, the UI event and the shipping sink once each: %d, %d, %d",
			len(buffered), len(emitted), len(shipped))
	}
	sinks := map[string]LogEntry{"GetLogs": buffered[0], "UI event": emitted[0], "shipping sink": shipped[0]}
	for where, entry := range sinks {
		requireNoLeak(t, where, entry.Message)
		// The line is still a line: its fields are parsed, and the text around the
		// credentials is kept.
		structured := entry.Level == "error" && entry.Timestamp == "2024-01-15T10:30:00.000Z"
		if !structured || !strings.Contains(entry.Message, "request failed") {
			t.Errorf("%s lost the structure of the line: %+v", where, entry)
		}
	}

	matches, err := mgr.SearchLogs("alpha", "hunter2|abc123def456ghi789")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Errorf("SearchLogs finds a credential that was supposed to be gone: %+v", matches)
	}
}

// A pattern that reaches across a newline would take the next line's timestamp
// for the value of a key at the end of this one, and the next line would stop
// being parsed.
func TestStreamRedactsOneLineAtATime(t *testing.T) {
	mgr, err := NewManager(t.TempDir(), DefaultRotation())
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	chunk := "2024-01-15T10:30:00.000Z [INFO] alpha: refreshing token:\n" +
		"2024-01-15T10:30:01.000Z [WARN] alpha: done\n"
	if _, err = mgr.Stream("alpha").Write([]byte(chunk)); err != nil {
		t.Fatal(err)
	}

	entries := mgr.GetLogs("alpha", 0)
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2: %+v", len(entries), entries)
	}
	got := entries[1]
	if got.Timestamp != "2024-01-15T10:30:01.000Z" || got.Level != "warn" || got.Message != "alpha: done" {
		t.Errorf("the second line was altered by the first: %+v", got)
	}
}

func TestStreamLeavesOrdinaryLinesAsTheyAre(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	chunk := "2024-01-15T10:30:00.000Z [DEBUG] alpha: pulled image " +
		"sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db in 2s\r\n" +
		"plain text from a panic: runtime error: index out of range [3] with length 3\n" +
		"\n" +
		"no trailing newline"
	n, err := mgr.Stream("alpha").Write([]byte(chunk))
	if err != nil || n != len(chunk) {
		t.Fatalf("Write = (%d, %v), want (%d, nil)", n, err, len(chunk))
	}
	raw, err := os.ReadFile(filepath.Join(dir, "plugin.alpha.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != chunk {
		t.Errorf("a chunk with nothing to redact was changed:\n got %q\nwant %q", raw, chunk)
	}
}

// io.MultiWriter, which feeds the stream together with stdout, turns n != len(p)
// into io.ErrShortWrite. Redaction changes the length of a line.
func TestStreamWriteReportsTheBytesItWasGivenWhenRedactionChangesTheLength(t *testing.T) {
	mgr, err := NewManager(t.TempDir(), DefaultRotation())
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	for name, line := range map[string]string{
		"longer":  "2024-01-15T10:30:00.000Z [INFO] alpha: password=x\n",
		"shorter": "2024-01-15T10:30:00.000Z [INFO] alpha: password=" + strings.Repeat("y", 64) + "\n",
	} {
		w := io.MultiWriter(io.Discard, mgr.Stream("alpha"))
		if n, writeErr := w.Write([]byte(line)); writeErr != nil || n != len(line) {
			t.Errorf("%s: Write = (%d, %v), want (%d, nil)", name, n, writeErr, len(line))
		}
	}
}

// A line too long to be parsed is not kept in the buffer, but it is still
// written to the file.
func TestStreamRedactsLinesTooLongToBeBuffered(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatal(err)
	}
	defer mgr.Close()

	huge := strings.Repeat("x", 80*1024) + " " + leakedPassword + " " + strings.Repeat("y", 8) + "\n"
	if _, err = mgr.Stream("alpha").Write([]byte(huge)); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "plugin.alpha.log"))
	if err != nil {
		t.Fatal(err)
	}
	requireNoLeak(t, "plugin.alpha.log", string(raw))
	if got := len(mgr.GetLogs("alpha", 0)); got != 0 {
		t.Errorf("an oversized line was buffered: %d entries", got)
	}
}

// The host's stdout also gets a copy of what a plugin writes, and stdout is not
// nowhere: a terminal keeps it, so do the systemd journal and the development
// supervisor's log. RedactingWriter redacts that copy line by line, as Stream does.
func TestRedactingWriterRedactsEachLineAndReportsWhatItWasGiven(t *testing.T) {
	var out bytes.Buffer
	line := leakingLine()
	n, err := RedactingWriter(&out).Write([]byte(line))
	if err != nil || n != len(line) {
		t.Fatalf("Write = (%d, %v), want (%d, nil): the caller handed over %d bytes", n, err, len(line), len(line))
	}
	requireNoLeak(t, "the copy", out.String())
	if !strings.HasPrefix(out.String(), "2024-01-15T10:30:00.000Z [ERROR] alpha: request failed: ") || !strings.HasSuffix(out.String(), "\n") {
		t.Errorf("the line lost its structure: %q", out.String())
	}

	// A line that ends in a key does not reach into the next one.
	out.Reset()
	chunk := "2024-01-15T10:30:00.000Z [INFO] alpha: refreshing token:\n2024-01-15T10:30:01.000Z [WARN] alpha: done\n"
	if _, err = RedactingWriter(&out).Write([]byte(chunk)); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(out.String(), "\n2024-01-15T10:30:01.000Z [WARN] alpha: done\n") {
		t.Errorf("the second line was altered by the first: %q", out.String())
	}
}

func TestRedactingWriterWritesALineWithNothingToRedactAsItIs(t *testing.T) {
	var out bytes.Buffer
	chunk := "2024-01-15T10:30:00.000Z [DEBUG] alpha: pulled image " +
		"sha256:3d380ca8864549e74af4b29c10f9cb0956236dfb01c40ca076fb6c37253234db in 2s\r\n\nno trailing newline"
	n, err := RedactingWriter(&out).Write([]byte(chunk))
	if err != nil || n != len(chunk) || out.String() != chunk {
		t.Fatalf("Write = (%d, %v), wrote %q; want it written as it is", n, err, out.String())
	}
}

// failingWriter takes accepted bytes and then fails.
type failingWriter struct {
	accepted int
	err      error
}

func (w failingWriter) Write([]byte) (int, error) { return w.accepted, w.err }

func TestRedactingWriterPassesItsWriterErrorThrough(t *testing.T) {
	boom := errors.New("boom")
	line := leakingLine()
	n, err := RedactingWriter(failingWriter{accepted: 3, err: boom}).Write([]byte(line))
	if !errors.Is(err, boom) || n != 3 {
		t.Errorf("Write = (%d, %v), want (3, boom)", n, err)
	}
	// More accepted than the caller gave, which redaction can cause, is not reported.
	short := []byte("password=x\n")
	n, err = RedactingWriter(failingWriter{accepted: 1000, err: boom}).Write(short)
	if !errors.Is(err, boom) || n != len(short) {
		t.Errorf("Write = (%d, %v), want (%d, boom)", n, err, len(short))
	}
}
