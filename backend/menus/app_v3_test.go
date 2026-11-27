package menus

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// menuRow is one View/File menu entry as the library reports it.
type menuRow struct {
	Label       string
	Accelerator string
	Separator   bool
}

// accel returns the accelerator string the library reports on this OS for the
// chord "CmdOrCtrl+<modifier>+<key>" (modifier "" for none). The expected rows
// below are written from the chords the menu is specified with; the library
// renders them per OS (Cmd on macOS, Ctrl elsewhere, modifiers sorted), so the
// expectation is rendered by the same library and never hand-encodes an OS.
func accel(modifier, key string) string {
	chord := "CmdOrCtrl+"
	if modifier != "" {
		chord += modifier + "+"
	}
	return rendered(chord + key)
}

// rendered returns the accelerator string the library reports for a chord written as the menu is specified.
func rendered(chord string) string {
	return application.NewMenu().Add("chord").SetAccelerator(chord).GetAccelerator()
}

// fileItems is the commands of the File menu on an OS, in order: the label (Windows draws the chord the page binds as
// text after a tab where the item binds none) and the accelerator the OS binds.
func fileItems(goos string) []menuRow {
	switch goos {
	case "darwin":
		return []menuRow{{Label: "Close Tab"}, {Label: "Reopen Closed Tab", Accelerator: rendered("Cmd+Shift+T")}}
	case "windows":
		return []menuRow{{Label: "Close Tab\tCtrl+W"}, {Label: "Reopen Closed Tab\tCtrl+Alt+Shift+T"}}
	default:
		return []menuRow{{Label: "Close Tab"}, {Label: "Reopen Closed Tab"}}
	}
}

// viewItems is the same for the commands of the View menu: the chords each OS binds are what the menu is specified with.
func viewItems(goos string) []menuRow {
	switch goos {
	case "darwin":
		return []menuRow{
			{Label: "Search…"},
			{Label: "Toggle Panel", Accelerator: rendered("Cmd+J")},
			{Label: "Toggle Maximized Panel", Accelerator: rendered("Cmd+Shift+J")},
			{Label: "New Terminal", Accelerator: rendered("Ctrl+Shift+`")},
			{Label: "Next Tab", Accelerator: rendered("Cmd+Shift+]")},
			{Label: "Previous Tab", Accelerator: rendered("Cmd+Shift+[")},
		}
	case "windows":
		return []menuRow{
			{Label: "Search…\tCtrl+K"},
			{Label: "Toggle Panel\tCtrl+J"},
			{Label: "Toggle Maximized Panel", Accelerator: rendered("Ctrl+Alt+Shift+J")},
			{Label: "New Terminal", Accelerator: rendered("Ctrl+Shift+T")},
			{Label: "Next Tab\tCtrl+Tab"},
			{Label: "Previous Tab\tCtrl+Shift+Tab"},
		}
	default:
		return []menuRow{
			{Label: "Search…"},
			{Label: "Toggle Panel"},
			{Label: "Toggle Maximized Panel", Accelerator: rendered("Ctrl+Alt+Shift+J")},
			{Label: "New Terminal", Accelerator: rendered("Ctrl+Shift+T")},
			{Label: "Next Tab"},
			{Label: "Previous Tab"},
		}
	}
}

// developmentViewMenu is the View menu with every item: label, accelerator, separator, in order.
func developmentViewMenu() []menuRow {
	return append(viewItems(runtime.GOOS),
		menuRow{Separator: true},
		menuRow{Label: "Reload", Accelerator: accel("", "R")},
		menuRow{Label: "Force Reload", Accelerator: accel("Shift", "F")},
		menuRow{Separator: true},
		menuRow{Label: "Zoom In", Accelerator: accel("", "Plus")},
		menuRow{Label: "Zoom Out", Accelerator: accel("", "-")},
		menuRow{Label: "Reset Zoom", Accelerator: accel("", "0")},
	)
}

// rowsOf reads the items of a menu.
func rowsOf(menu *application.Menu) []menuRow {
	var rows []menuRow
	for i := 0; menu.ItemAt(i) != nil; i++ {
		item := menu.ItemAt(i)
		rows = append(rows, menuRow{
			Label:       item.Label(),
			Accelerator: item.GetAccelerator(),
			Separator:   item.IsSeparator(),
		})
	}
	return rows
}

// submenuRows builds a bare menu with build, then returns the rows of the one
// submenu it added.
func submenuRows(t *testing.T, wantLabel string, build func(*application.Menu)) []menuRow {
	t.Helper()
	menu := application.NewMenu()
	build(menu)

	top := menu.ItemAt(0)
	require.NotNil(t, top, "builder added no top-level item")
	require.Nil(t, menu.ItemAt(1), "builder added more than one top-level item")
	require.True(t, top.IsSubmenu())
	require.Equal(t, wantLabel, top.Label())

	sub := top.GetSubmenu()
	require.NotNil(t, sub)
	return rowsOf(sub)
}

func viewRows(t *testing.T, reload bool) []menuRow {
	t.Helper()
	return submenuRows(t, "View", func(menu *application.Menu) {
		addViewMenu(menu, &application.App{}, nil, reload)
	})
}

func hasAccelerator(rows []menuRow, accelerator string) bool {
	for _, row := range rows {
		if row.Accelerator == accelerator {
			return true
		}
	}
	return false
}

// recordedEvents records what a click emits.
type recordedEvents struct {
	emitted [][]any
}

func (r *recordedEvents) Emit(name string, data ...any) bool {
	r.emitted = append(r.emitted, append([]any{name}, data...))
	return false
}

func TestViewMenuDevelopment(t *testing.T) {
	assert.Equal(t, developmentViewMenu(), viewRows(t, true))
}

func TestViewMenuPackagedDropsOnlyReload(t *testing.T) {
	var want []menuRow
	for _, row := range developmentViewMenu() {
		if row.Label != "Reload" {
			want = append(want, row)
		}
	}

	assert.Equal(t, want, viewRows(t, false))
}

func TestReloadAcceleratorOnlyInDevelopment(t *testing.T) {
	reloadChord := accel("", "R")

	development := viewRows(t, true)
	assert.True(t, hasAccelerator(development, reloadChord), "development View menu must keep Reload")
	assert.Contains(t, development, menuRow{Label: "Reload", Accelerator: reloadChord})

	packaged := viewRows(t, false)
	assert.False(t, hasAccelerator(packaged, reloadChord), "packaged View menu must not claim the reload chord")
	for _, row := range packaged {
		assert.NotEqual(t, "Reload", row.Label)
	}
}

func TestCommandRowsHaveALabelAndAnID(t *testing.T) {
	ids := map[string]bool{}
	for _, row := range append(fileCommands(), viewCommands()...) {
		assert.NotEmpty(t, row.label)
		assert.NotEmpty(t, row.id, row.label)
		assert.False(t, ids[row.id], "%s is the id of two rows", row.id)
		ids[row.id] = true
		// Windows binds the accelerator or draws the chord the page binds as text: a row has one or the other.
		assert.NotEqual(t, row.other == "", row.shown == "", row.label)
	}
}

func TestCommandItemsOnEachOS(t *testing.T) {
	for _, goos := range []string{"darwin", "windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			file := application.NewMenu()
			addCommands(file, fileCommands(), &recordedEvents{}, goos)
			assert.Equal(t, fileItems(goos), rowsOf(file))

			view := application.NewMenu()
			addCommands(view, viewCommands(), &recordedEvents{}, goos)
			assert.Equal(t, viewItems(goos), rowsOf(view))
		})
	}
}

func TestCommandClickTellsEveryWindowTheCommand(t *testing.T) {
	// New Terminal and Toggle Panel also send the event the old shell listens to for the same action.
	old := map[string]string{"host.terminal.new": EventTerminalCreate, "host.panel.toggle": EventBottomDrawerMinimize}

	for _, row := range append(fileCommands(), viewCommands()...) {
		events := &recordedEvents{}
		commandClick(row, events)(nil)

		want := [][]any{{EventCommand, row.id}}
		if legacy, ok := old[row.id]; ok {
			want = append(want, []any{legacy})
		}
		assert.Equal(t, want, events.emitted, row.id)
	}
}

func TestFileMenu(t *testing.T) {
	rows := submenuRows(t, "File", func(menu *application.Menu) {
		addFileMenu(menu, &recordedEvents{}, func() windowCloser { return &fakeWindow{} })
	})

	want := fileItems("darwin")
	want = append(want, menuRow{Separator: true}, menuRow{Label: "Close Window", Accelerator: accel("Shift", "W")})
	assert.Equal(t, want, rows)
}

// fakeWindow records every call it receives.
type fakeWindow struct {
	calls []string
}

func (w *fakeWindow) Close() { w.calls = append(w.calls, "Close") }

// strayWindow is a window the focused lookup does not return.
type strayWindow struct {
	calls []string
}

func (w *strayWindow) Close() { w.calls = append(w.calls, "Close") }

func TestCloseFocusedClosesTheFocusedWindowOnce(t *testing.T) {
	focused := &fakeWindow{}
	stray := &strayWindow{}
	lookups := 0

	handler := closeFocused(func() windowCloser {
		lookups++
		return focused
	})
	handler(nil)

	assert.Equal(t, []string{"Close"}, focused.calls)
	assert.Empty(t, stray.calls)
	assert.Equal(t, 1, lookups, "the focused window must be looked up once per click")
}
