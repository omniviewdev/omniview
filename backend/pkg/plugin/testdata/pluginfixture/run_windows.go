//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"unsafe"
)

const (
	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x2000
)

type ioCounters struct {
	ReadOperationCount, WriteOperationCount, OtherOperationCount uint64
	ReadTransferCount, WriteTransferCount, OtherTransferCount    uint64
}

type basicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type extendedLimitInformation struct {
	BasicLimitInformation basicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// run starts the command as this process's child with its standard streams and
// returns its exit status. Windows cannot replace a process, and the host kills
// only the process it started, so this process first joins a job that ends with
// it: when the host kills the fixture, the command it runs dies with it, as it
// does on Unix where the two are one process. Failing to make the job is not an
// error: the command then simply outlives a kill.
func run(args []string) int {
	killChildrenWithMe()
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exit):
		return exit.ExitCode()
	}
	fmt.Fprintln(os.Stderr, "pluginfixture:", err)
	return 127
}

func killChildrenWithMe() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	job, _, _ := kernel32.NewProc("CreateJobObjectW").Call(0, 0)
	if job == 0 {
		return
	}
	var info extendedLimitInformation
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	if ok, _, _ := kernel32.NewProc("SetInformationJobObject").Call(
		job, jobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info)); ok == 0 {
		return
	}
	self, err := syscall.GetCurrentProcess()
	if err != nil {
		return
	}
	// The job handle is never closed: closing it, which the system does when this
	// process ends, is what ends the command.
	_, _, _ = kernel32.NewProc("AssignProcessToJobObject").Call(job, uintptr(self))
}
