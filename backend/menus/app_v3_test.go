package menus

import (
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
	return application.NewMenu().Add("chord").SetAccelerator(chord + key).GetAccelerator()
}

// developmentViewMenu is the View menu exactly as it shipped before decision
// A18, written out by hand: label, accelerator, separator, in order.
func developmentViewMenu() []menuRow {
	return []menuRow{
		{Label: "Reload", Accelerator: accel("", "R")},
		{Label: "Force Reload", Accelerator: accel("Shift", "F")},
		{Separator: true},
		{Label: "Zoom In", Accelerator: accel("", "Plus")},
		{Label: "Zoom Out", Accelerator: accel("", "-")},
		{Label: "Reset Zoom", Accelerator: accel("", "0")},
		{Separator: true},
		{Label: "New Terminal Session", Accelerator: accel("Shift", "T")},
		{Label: "Minimize Bottom Menu", Accelerator: accel("Shift", "B")},
		{Label: "Maximize Bottom Menu", Accelerator: accel("Alt", "B")},
		{Separator: true},
		{Label: "Close Sidebar", Accelerator: accel("Shift", "S")},
	}
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
	var rows []menuRow
	for i := 0; sub.ItemAt(i) != nil; i++ {
		item := sub.ItemAt(i)
		rows = append(rows, menuRow{
			Label:       item.Label(),
			Accelerator: item.GetAccelerator(),
			Separator:   item.IsSeparator(),
		})
	}
	return rows
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

func TestViewMenuDevelopmentIsUnchanged(t *testing.T) {
	assert.Equal(t, developmentViewMenu(), viewRows(t, true))
}

func TestViewMenuPackagedDropsOnlyReload(t *testing.T) {
	want := developmentViewMenu()[1:]
	got := viewRows(t, false)

	assert.Equal(t, want, got)
	require.NotEmpty(t, got)
	assert.Equal(t, menuRow{Label: "Force Reload", Accelerator: accel("Shift", "F")}, got[0])
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

func TestCloseWindowMenu(t *testing.T) {
	rows := submenuRows(t, "File", func(menu *application.Menu) {
		addCloseWindowMenu(menu, func() windowCloser { return &fakeWindow{} })
	})

	assert.Equal(t, []menuRow{{Label: "Close Window", Accelerator: accel("Shift", "W")}}, rows)
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
