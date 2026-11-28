package categories

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The new UI's Settings draws what the host declares, and its tests run against a hand-written copy of the terminal
// category (ui-next/shell/settings/model/testing.ts: the page cannot import Go). This test ties the copy to the
// declaration: every setting of the terminal category is in it, with the same type, label and description, so that a
// setting the host adds (the opt-out of the shell integration, issue #694 step 6) cannot be missing from what the
// page's tests prove it draws.

var fixtureSetting = regexp.MustCompile(`(?m)^\s*setting\('(\w+)', '(\w+)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', ('(?:[^'\\]|\\.)*'|true|false|\d+(?:\.\d+)?)`)

func unescape(text string) string { return strings.ReplaceAll(text, `\'`, `'`) }

func TestTheUIsCopyOfTheTerminalCategoryHasEverySettingTheHostDeclares(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "ui-next", "shell", "settings", "model", "testing.ts"))
	require.NoError(t, err)
	text := string(raw)
	start := strings.Index(text, "export const TERMINAL = category('terminal'")
	require.GreaterOrEqual(t, start, 0, "the fixture has the terminal category")
	end := strings.Index(text[start:], "\n]);")
	require.Positive(t, end)

	copied := map[string][4]string{}
	for _, match := range fixtureSetting.FindAllStringSubmatch(text[start:start+end], -1) {
		def := match[5]
		if strings.HasPrefix(def, "'") {
			def = unescape(def[1 : len(def)-1])
		}
		copied[match[1]] = [4]string{match[2], unescape(match[3]), unescape(match[4]), def}
	}

	declared := Terminal.Settings
	for id, setting := range declared {
		got, ok := copied[id]
		if !assert.True(t, ok, "the UI's copy of the terminal category lacks the setting %q the host declares", id) {
			continue
		}
		assert.Equal(t, [3]string{string(setting.Type), setting.Label, setting.Description}, [3]string{got[0], got[1], got[2]}, "the UI's copy of %q says what the host declares", id)
		if id == "defaultShell" {
			continue // the host's own default is the account's shell: it differs by machine
		}
		assert.Equal(t, fmt.Sprint(setting.Default), got[3], "the UI's copy of %q has the host's default", id)
	}
	for id := range copied {
		assert.Contains(t, declared, id, "the UI's copy declares a setting the host does not")
	}
}
