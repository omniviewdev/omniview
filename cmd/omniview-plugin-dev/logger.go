package main

import (
	"fmt"
	"os"
	"time"
)

// ANSI color codes
const (
	colorReset  = "\033[0m"
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorBlue   = "\033[34m"
	colorPurple = "\033[35m"
	colorCyan   = "\033[36m"
	colorGray   = "\033[90m"
	colorBold   = "\033[1m"
)

// Logger provides color-coded multiplexed output for all subprocesses.
type Logger struct {
	verbose bool
}

func NewLogger(verbose bool) *Logger {
	return &Logger{verbose: verbose}
}

func (l *Logger) timestamp() string {
	return time.Now().Format("15:04:05")
}

func (l *Logger) System(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[system]%s %s\n",
		colorGray, l.timestamp(), colorBold+colorCyan, colorReset, msg)
}

func (l *Logger) Vite(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[vite]%s   %s\n",
		colorGray, l.timestamp(), colorPurple, colorReset, line)
}

func (l *Logger) Go(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[go]%s     %s\n",
		colorGray, l.timestamp(), colorGreen, colorReset, line)
}

func (l *Logger) Plugin(line string) {
	fmt.Fprintf(os.Stderr, "%s%s %s[plugin]%s %s\n",
		colorGray, l.timestamp(), colorBlue, colorReset, line)
}

func (l *Logger) Error(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[error]%s  %s%s%s\n",
		colorGray, l.timestamp(), colorRed, colorReset, colorRed, msg, colorReset)
}

func (l *Logger) Debug(format string, args ...any) {
	if !l.verbose {
		return
	}
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "%s%s %s[debug]%s  %s\n",
		colorGray, l.timestamp(), colorGray, colorReset, msg)
}
