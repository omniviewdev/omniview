//go:build !windows

package terminal

import (
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE TITLE ON THE STREAM (issue #695 step 4; docs/ui-next/terminal-channel-protocol.md section 4b).
//
// The host reads OSC 0 and 2 out of the output and says the title in a frame of its own (0x8c), to a page that asked for it in its attach,
// with the producer's fact "a program runs": the process group that holds the terminal's foreground is not the shell's, or the shell's
// integration said a command it vouched for has started and not ended. The page never infers it.

// shellTitleScript has the shell itself write one title twice, with a marker line after each, and wait for input: when the page has the last marker, everything before it is in its output.
const shellTitleScript = `printf '\033]2;shell title\007'; printf 'a\n'; printf '\033]2;shell title\007'; printf 'done\n'; read x`

// waitTitles waits until the page has taken n title frames and says them.
func waitTitles(t *testing.T, p *chanPage, n int) []titleWire {
	t.Helper()
	st := p.waitFor("title frames", func(s pageState) bool { return len(s.titles) >= n })
	require.Empty(t, st.faults, "the stream is as the protocol says")
	return st.titles
}

// waitOutput waits until the page has taken text in the output.
func waitOutput(t *testing.T, p *chanPage, text string) pageState {
	t.Helper()
	return p.waitFor(text+" in the output", func(s pageState) bool { return strings.Contains(string(s.bytes()), text) })
}

func TestTheTitleAProgramSetsIsSaidWithTheFactThatAProgramRunsAndTheFactEndsWithTheProgram(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	// cat holds the foreground and writes back what it is typed (the terminal does not echo): a title typed to it is a title a program sets.
	info := m.startChannel(t, `stty -echo; printf 'up\n'; cat; printf 'after\n'; read x`, Options{})
	page := m.attachTitle(t, info.Cap, nil, false)
	ready := page.waitReady()
	guarded(t, "ready-says-title", func() {
		assert.Equal(t, 1, ready.Title, "the page asked for the frame of version 1: the ready frame says it is coming")
	})
	waitOutput(t, page, "up")
	require.Eventually(t, func() bool {
		busy, err := m.ChannelBusy(info.Cap)
		return err == nil && busy.State == StateBusy
	}, settle, 5*time.Millisecond, "the shell has handed the terminal to cat")

	page.input("\x1b]2;mytitle\x07\n")
	got := waitTitles(t, page, 1)
	guarded(t, "title-while-the-program-runs", func() {
		assert.Equal(t, titleWire{V: 1, Title: "mytitle", Program: true}, got[0], "the title, and the host's word that a program holds the terminal")
	})

	page.input("\x04") // the end of input: cat ends and the shell takes the terminal back
	waitOutput(t, page, "after")
	got = waitTitles(t, page, 2)
	guarded(t, "title-detached-when-the-program-ends", func() {
		assert.Equal(t, titleWire{V: 1, Title: "mytitle", Program: false}, got[1], "the title is the program's no longer: the host says no program runs, and the page shows the shell's name")
	})
	assert.Len(t, page.state().titles, 2, "one frame for each change of the pair, and no more")
}

func TestATitleTheShellSetsItselfIsNotAProgramsAndASameTitleIsOneFrame(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, shellTitleScript, Options{})
	page := m.attachTitle(t, info.Cap, nil, false)
	page.waitReady()
	waitOutput(t, page, "done")
	got := page.state().titles
	require.Len(t, got, 1, "the same title twice is said once")
	guarded(t, "shell-title-is-not-a-program", func() {
		assert.Equal(t, titleWire{V: 1, Title: "shell title", Program: false}, got[0], "the shell holds the foreground: no program runs, whatever the title says")
	})
}

func TestAPageThatDidNotAskIsSentNoTitleFrameAndReadyDoesNotSayOne(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, shellTitleScript, Options{})
	asked := m.attachTitle(t, info.Cap, nil, false)
	asked.waitReady()
	waitOutput(t, asked, "done")
	require.Len(t, asked.state().titles, 1, "a page that asks is sent the title")

	// The page that takes the terminal over does not ask: an unasked frame would break a page of this version 2 that never heard of it.
	plain := m.attach(t, info.Cap, nil)
	ready := plain.waitReady()
	waitOutput(t, plain, "done")
	guarded(t, "unasked-page-no-title", func() {
		assert.Empty(t, plain.state().titles, "a page that did not ask is sent no title frame")
		assert.Zero(t, ready.Title, "and ready does not say one is coming")
	})
	assert.Empty(t, plain.state().faults)
}

func TestAPageThatComesBackIsSentTheTitleTheHostHoldsAfterReady(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, shellTitleScript, Options{})
	first := m.attachTitle(t, info.Cap, nil, false)
	first.waitReady()
	waitOutput(t, first, "done")
	require.Len(t, first.state().titles, 1)
	first.detach()
	first.waitClosed()

	// It asks for the output from its end: there is nothing to replay, and the title is the host's fact, not part of the bytes.
	end := first.state().next
	second := m.attachTitle(t, info.Cap, &end, false)
	second.waitReady()
	got := waitTitles(t, second, 1)
	guarded(t, "title-sent-to-a-page-that-comes-back", func() {
		assert.Equal(t, titleWire{V: 1, Title: "shell title", Program: false}, got[0], "a reload gets the title the terminal has, though the bytes that set it are not replayed")
	})
	assert.Empty(t, second.state().segs, "no output was replayed")
}

func TestATitleOfAHundredKilobytesAndOneWithControlsAreBoundedAndCleanOnTheStream(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	script := `printf '\033]2;'; head -c 102400 /dev/zero | tr '\0' A; printf '\007'; printf 'first\n'; ` +
		`printf '\033]2;a\001b\033[31mred\033[0m\177c\007'; printf 'second\n'; ` +
		`printf '\033]0;\342\200\256evil\342\200\254\007'; printf 'third\n'; read x`
	info := m.startChannel(t, script, Options{})
	page := m.attachTitle(t, info.Cap, nil, false)
	page.waitReady()
	waitOutput(t, page, "third")
	got := page.state().titles
	require.Len(t, got, 3, "the three titles, each said once")
	guarded(t, "title-is-bounded", func() {
		assert.Equal(t, strings.Repeat("A", maxTitleBytes), got[0].Title, "100 KB of text is cut to what a title keeps")
	})
	guarded(t, "title-has-no-control", func() {
		assert.Equal(t, "abc", got[1].Title, "controls, an ESC and the text of the sequence it began are not in the title: the ESC ended the OSC, and what follows is a CSI")
	})
	guarded(t, "title-has-no-bidi-control", func() {
		assert.Equal(t, "evil", got[2].Title, "a right-to-left override does not reorder what the tab says")
	})
	for _, title := range got {
		assert.True(t, utf8.ValidString(title.Title))
		assert.LessOrEqual(t, len(title.Title), maxTitleBytes)
		for _, r := range title.Title {
			assert.False(t, unicode.IsControl(r), "no control character in %q", title.Title)
		}
	}
}

func TestACommandTheShellVouchedForMakesTheTitleAProgramsAndItsEndEndsIt(t *testing.T) {
	k := newMarked(t)
	page := k.f.m.attachTitle(t, k.info.Cap, nil, true)
	page.waitReady()
	start := osc("133;A") + "$ " + osc("133;B") + "build\r\n" + osc("633;E;build;"+k.nonce) + osc("133;C")
	k.print(start)
	k.print(osc("2;compiling"))
	got := waitTitles(t, page, 1)
	guarded(t, "title-of-a-vouched-command", func() {
		assert.Equal(t, titleWire{V: 1, Title: "compiling", Program: true}, got[0], "the shell said a command runs: the title is a program's even where the shell holds the foreground")
	})

	k.print(osc("133;D;0") + osc("633;P;Cwd=/tmp;"+k.nonce) + osc("133;A") + "$ ")
	got = waitTitles(t, page, 2)
	guarded(t, "title-detached-by-the-end-mark", func() {
		assert.Equal(t, titleWire{V: 1, Title: "compiling", Program: false}, got[1], "the command ended: the host says no program runs, with no title set after it")
	})
	assert.Len(t, page.state().titles, 2)
}

func TestAForgedStartMarkDoesNotMakeATitleAProgramsAndATitleOfAnUnverifiedCommandIsNotOne(t *testing.T) {
	k := newMarked(t)
	page := k.f.m.attachTitle(t, k.info.Cap, nil, true)
	page.waitReady()
	// Any program can print the marks of a prompt and a start: without the line the nonce vouches for, they prove nothing.
	k.print(osc("133;C") + osc("633;E;build;wrong-nonce") + osc("2;forged"))
	got := waitTitles(t, page, 1)
	guarded(t, "forged-start-is-no-program", func() {
		assert.Equal(t, titleWire{V: 1, Title: "forged", Program: false}, got[0], "a start nobody vouched for is not a program")
	})
}

func TestATerminalThatEndedAndIsAttachedAfterwardsIsSentNoTitleAndReadySaysNone(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `printf '\033]2;gone\007'; printf 'bye\n'; exit 0`, Options{})
	first := m.attachTitle(t, info.Cap, nil, false)
	first.waitClosed()

	late := m.attachTitle(t, info.Cap, nil, false)
	ready := late.waitReady()
	late.waitClosed()
	guarded(t, "ended-terminal-no-title", func() {
		assert.Zero(t, ready.Title, "the kept end of a terminal states no title")
		assert.Empty(t, late.state().titles)
	})
	assert.Empty(t, late.state().faults)
}
