package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// The frames of the stream and ws transports. Host to page: [fOutput][offset u64][bytes] and [fEnd][json]. Page to
// host: [fWrite][seq u64][bytes], [fAck][n u32], [fResize][rows u16][cols u16]. The very first frame of a connection is
// the page's, and is JSON: {"cap":"...","from":N}. Nothing secret is ever in a URL.
const (
	fOutput byte = 1
	fEnd    byte = 2
	fWrite  byte = 'w'
	fAck    byte = 'a'
	fResize byte = 'r'
)

// programs are what the probe's terminals run. The shell the manager starts has to be one it knows: `sh -c`.
var programs = map[string]string{
	// waits for one line (the go signal, sent once the page is connected), then floods like B-110's `yes`.
	"flood": `read x; exec yes FLOODFLOODFLOODFLOODFLOODFLOODFLOOD`,
	// 10 MB/s: one megabyte every 100 ms
	"flood10": `read x; exec perl -e '$|=1; while(1){ print "FLOODFLOODFLOODFLOOD" x 50000, "\n"; select(undef,undef,undef,0.1) }'`,
	// a round trip through a process: the tty is raw and silent, cat writes back what it reads.
	"echo": `stty raw -echo; exec cat`,
	// numbered lines, for byte-exactness.
	"numbered": `read x; exec awk 'BEGIN{for(i=1;i<=3000000;i++)print i}'`,
}

// Probe is the bound service the page calls: every method that names a terminal takes its capability, never its id.
type Probe struct{ p *probe }

type probe struct {
	app *application.App
	win *application.WebviewWindow
	log logging.Logger
	mgr *terminal.Manager

	mu    sync.Mutex
	byCap map[string]*term
	byID  map[string]*term

	wsPort  int
	started time.Time
	report  chan string
	sampler sync.Once
	pullWin int
}

func newProbe(log logging.Logger) *probe {
	p := &probe{log: log, byCap: map[string]*term{}, byID: map[string]*term{}, started: time.Now(), report: make(chan string, 16)}
	p.pullWin = envInt("PROBE_PULL_WINDOW", 1<<20)
	p.mgr = terminal.NewManager(context.Background(), log, &chanSink{p: p})
	return p
}

// term is one terminal of the probe and the connection that holds it.
type term struct {
	p         *probe
	id, cap   string
	transport string

	mu     sync.Mutex
	cond   *sync.Cond
	conn   outConn
	off    uint64
	closed bool
	end    terminal.End
	pull   *pullBuf

	sent  atomic.Int64 // bytes the transport took (Send returned)
	acked atomic.Int64
}

type outConn interface {
	send(frame []byte) error
	close()
}

func newCap() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func (p *probe) lookup(cap string) *term {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.byCap[cap]
}

func (p *probe) get(id string) *term {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.byID[id]
}

type Created struct {
	ID        string `json:"id"`
	Cap       string `json:"cap"`
	Transport string `json:"transport"`
	PID       int    `json:"pid"`
}

// Config is what the page needs to know before it starts.
type Config struct {
	WSPort     int    `json:"ws_port"`
	Build      string `json:"build"`
	PullWindow int    `json:"pull_window"`
}

func (s *Probe) Config() Config {
	return Config{WSPort: s.p.wsPort, Build: buildName, PullWindow: s.p.pullWin}
}

// Create starts a terminal that runs one of the programs, for the transport the page will read it with.
func (s *Probe) Create(kind, transport string, cols, rows int) (Created, error) {
	script, ok := programs[kind]
	if !ok {
		return Created{}, fmt.Errorf("unknown kind %q", kind)
	}
	p := s.p
	t := &term{p: p, id: "t-" + newCap()[:12], cap: newCap(), transport: transport}
	t.cond = sync.NewCond(&t.mu)
	if transport == "pull" {
		t.pull = newPullBuf(p.pullWin)
	}
	p.mu.Lock()
	p.byCap[t.cap] = t
	p.byID[t.id] = t
	p.mu.Unlock()
	info, err := p.mgr.Start(terminal.Options{ID: t.id, Command: []string{"sh", "-c", script}, Cols: cols, Rows: rows}, "probe")
	if err != nil {
		p.mu.Lock()
		delete(p.byCap, t.cap)
		delete(p.byID, t.id)
		p.mu.Unlock()
		return Created{}, err
	}
	p.sampler.Do(func() { go p.sample() })
	return Created{ID: t.id, Cap: t.cap, Transport: transport, PID: info.PID}, nil
}

// notFound is what every call says for a capability nobody holds: the same words whatever the reason.
var errNotFound = errors.New("not found")

func (s *Probe) Write(cap string, seq uint64, data []byte) error {
	t := s.p.lookup(cap)
	if t == nil {
		return errNotFound
	}
	return s.p.mgr.Write(t.id, seq, data)
}

func (s *Probe) Resize(cap string, seq uint64, rows, cols int) error {
	t := s.p.lookup(cap)
	if t == nil {
		return errNotFound
	}
	return s.p.mgr.Resize(t.id, seq, rows, cols)
}

func (s *Probe) Ack(cap string, n int) error {
	t := s.p.lookup(cap)
	if t == nil {
		return errNotFound
	}
	t.acked.Add(int64(n))
	return s.p.mgr.Ack(t.id, n)
}

func (s *Probe) Close(cap string) error {
	t := s.p.lookup(cap)
	if t == nil {
		return errNotFound
	}
	return s.p.mgr.CloseSession(t.id)
}

// Stats is what the host counted for the capability's terminal.
type Stats struct {
	Sent   int64 `json:"sent"`
	Acked  int64 `json:"acked"`
	Offset uint64 `json:"offset"`
}

func (s *Probe) Stats(cap string) (Stats, error) {
	t := s.p.lookup(cap)
	if t == nil {
		return Stats{}, errNotFound
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return Stats{Sent: t.sent.Load(), Acked: t.acked.Load(), Offset: t.off}, nil
}

// Report is the page's result of a scenario: printed for the driver, which owns the file it goes into.
func (s *Probe) Report(payload string) {
	fmt.Printf("REPORT %s\n", payload)
	_ = os.Stdout.Sync()
	select {
	case s.p.report <- payload:
	default:
	}
}

// Note prints a line for the driver: progress of the page, for finding where a scenario stopped.
func (s *Probe) Note(msg string) {
	fmt.Printf("NOTE t=%.1f %s\n", time.Since(s.p.started).Seconds(), msg)
	_ = os.Stdout.Sync()
}

// Hide hides the native window (a no-op in the server build): the page is still loaded and running.
func (s *Probe) Hide() {
	if s.p.win != nil {
		s.p.win.Hide()
	}
}

func (s *Probe) Quit() {
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.p.app.Quit()
	}()
}

// chanSink is the manager's sink for every terminal of the probe: it hands the shell's bytes to the transport the
// terminal was created for, and the manager takes the return of Output for the delivery (a blocking write is the
// credit: a transport that does not take the bytes holds the shell in its own write).
type chanSink struct{ p *probe }

func (s *chanSink) Output(id string, data []byte) {
	t := s.p.get(id)
	if t == nil {
		return
	}
	t.mu.Lock()
	off := t.off
	t.off += uint64(len(data))
	t.mu.Unlock()
	if t.transport == "pull" {
		t.pull.put(data)
		t.sent.Add(int64(len(data)))
		return
	}
	conn := t.waitConn()
	if conn == nil {
		return
	}
	frame := make([]byte, 9+len(data))
	frame[0] = fOutput
	binary.BigEndian.PutUint64(frame[1:], off)
	copy(frame[9:], data)
	if err := conn.send(frame); err == nil {
		t.sent.Add(int64(len(data)))
	}
}

func (s *chanSink) Closed(id string, end terminal.End) {
	t := s.p.get(id)
	if t == nil {
		return
	}
	t.mu.Lock()
	t.closed = true
	t.end = end
	conn := t.conn
	t.cond.Broadcast()
	t.mu.Unlock()
	if t.pull != nil {
		t.pull.finish()
	}
	if conn != nil {
		_ = conn.send(append([]byte{fEnd}, fmt.Sprintf(`{"reason":%q}`, string(end.Reason))...))
	}
}

// waitConn blocks until a connection holds the terminal (or the terminal ended).
func (t *term) waitConn() outConn {
	t.mu.Lock()
	defer t.mu.Unlock()
	for t.conn == nil && !t.closed {
		t.cond.Wait()
	}
	return t.conn
}

// attach makes conn the holder of the terminal: output goes to it from now on.
func (t *term) attach(conn outConn) {
	t.mu.Lock()
	old := t.conn
	t.conn = conn
	t.cond.Broadcast()
	t.mu.Unlock()
	if old != nil && old != conn {
		old.close()
	}
}

func (t *term) detach(conn outConn) {
	t.mu.Lock()
	if t.conn == conn {
		t.conn = nil
	}
	t.mu.Unlock()
}

// serve reads the page's frames of one connection until it ends: input, resizes and acknowledgements.
func (p *probe) serve(t *term, recv func() ([]byte, error)) {
	for {
		frame, err := recv()
		if err != nil {
			return
		}
		if len(frame) == 0 {
			continue
		}
		switch frame[0] {
		case fWrite:
			if len(frame) >= 9 {
				_ = p.mgr.Write(t.id, binary.BigEndian.Uint64(frame[1:9]), frame[9:])
			}
		case fAck:
			if len(frame) >= 5 {
				n := int(binary.BigEndian.Uint32(frame[1:5]))
				t.acked.Add(int64(n))
				_ = p.mgr.Ack(t.id, n)
			}
		case fResize:
			if len(frame) >= 5 {
				_ = p.mgr.Resize(t.id, 0, int(binary.BigEndian.Uint16(frame[1:3])), int(binary.BigEndian.Uint16(frame[3:5])))
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------
// the sampler

func rssMiB(pid int) float64 {
	out, _ := exec.Command("/bin/ps", "-o", "rss=", "-p", strconv.Itoa(pid)).Output()
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return float64(n) / 1024
}

// webContentPIDs lists the WebKit content processes on the machine (macOS): the native build's page runs in one.
func webContentPIDs() map[int]float64 {
	out, err := exec.Command("/bin/ps", "-axo", "pid=,rss=,command=").Output()
	if err != nil {
		return nil
	}
	found := map[int]float64{}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "WebContent") && strings.Contains(line, "WebKit") {
			f := strings.Fields(line)
			if len(f) < 2 {
				continue
			}
			pid, _ := strconv.Atoi(f[0])
			rss, _ := strconv.Atoi(f[1])
			found[pid] = float64(rss) / 1024
		}
	}
	return found
}

var baselineWebContent = webContentPIDs()

// sample prints the host's memory every few seconds for the driver; the WebContent processes that did not exist when
// the probe started are the probe's own.
func (p *probe) sample() {
	every := time.Duration(envInt("PROBE_SAMPLE_MS", 5000)) * time.Millisecond
	me := os.Getpid()
	var ms runtime.MemStats
	for range time.Tick(every) {
		runtime.ReadMemStats(&ms)
		wc, n := 0.0, 0
		for pid, rss := range webContentPIDs() {
			if _, old := baselineWebContent[pid]; !old {
				wc += rss
				n++
			}
		}
		var sent int64
		p.mu.Lock()
		for _, t := range p.byID {
			sent += t.sent.Load()
		}
		p.mu.Unlock()
		fmt.Printf("SAMPLE t=%.1f hostRSS=%.1f heapLive=%.1f webcontent=%.1f(%d) sent=%.1f goroutines=%d\n",
			time.Since(p.started).Seconds(), rssMiB(me), float64(ms.HeapAlloc)/1048576, wc, n, float64(sent)/1048576, runtime.NumGoroutine())
		_ = os.Stdout.Sync()
	}
}
