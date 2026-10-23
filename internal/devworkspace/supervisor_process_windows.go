//go:build windows

package devworkspace

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type ownedWindowsJob struct{ job, leader windows.Handle }

var childJob sync.Map

func detachSupervisor(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS}
}
func prepareOwnedCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED | windows.CREATE_NEW_PROCESS_GROUP}
}
func attachOwnedCommand(child *ownedChild) error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		windows.CloseHandle(job)
		return err
	}
	leader, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.PROCESS_SUSPEND_RESUME|windows.SYNCHRONIZE, false, uint32(child.identity.PID))
	if err != nil {
		windows.CloseHandle(job)
		return err
	}
	fail := func(err error) error { windows.CloseHandle(job); windows.CloseHandle(leader); return err }
	if err = windows.AssignProcessToJobObject(job, leader); err != nil {
		return fail(err)
	}
	// No descendant can spawn before actual ownership is assigned.
	resume := windows.NewLazySystemDLL("ntdll.dll").NewProc("NtResumeProcess")
	result, _, _ := resume.Call(uintptr(leader))
	if result != 0 {
		return fail(fmt.Errorf("resume owned child failed: NTSTATUS %#x", result))
	}
	childJob.Store(child, ownedWindowsJob{job: job, leader: leader})
	child.stopTree = func(bool) error {
		child.mu.Lock()
		defer child.mu.Unlock()
		record, ok := childJob.Load(child)
		if !ok {
			return nil
		}
		return windows.TerminateJobObject(record.(ownedWindowsJob).job, 1)
	}
	return nil
}
func waitOwnedCommand(child *ownedChild) error {
	value, ok := childJob.Load(child)
	if !ok {
		return fmt.Errorf("owned Windows Job lifetime is missing")
	}
	record := value.(ownedWindowsJob)
	observed, observeErr := windows.WaitForSingleObject(record.leader, windows.INFINITE)
	if observeErr == nil && observed != windows.WAIT_OBJECT_0 {
		observeErr = fmt.Errorf("owned leader wait returned unexpected kernel status")
	}
	// Cmd.Wait also drains stdout/stderr. Kill Job descendants BEFORE that wait,
	// otherwise a descendant retaining a pipe can prevent both EOF and cleanup.
	var disposalErr error
	child.mu.Lock()
	if value, ok = childJob.Load(child); ok {
		record = value.(ownedWindowsJob)
		terminateErr := windows.TerminateJobObject(record.job, 1)
		if emptyErr := waitOwnedJobEmpty(record.job); emptyErr != nil {
			// Unproven disposal is not an exit. Retain both exact handles and
			// leave the leader unreaped so Stop can retry this same Job lifetime.
			child.mu.Unlock()
			return errors.Join(observeErr, terminateErr, emptyErr)
		}
		childJob.Delete(child)
		disposalErr = errors.Join(disposalErr, windows.CloseHandle(record.job), windows.CloseHandle(record.leader))
	}
	child.mu.Unlock()
	waitErr := child.command.Wait()
	child.mu.Lock()
	child.disposed = child.command.ProcessState != nil
	child.mu.Unlock()
	if observeErr != nil {
		return observeErr
	}
	if disposalErr != nil {
		return disposalErr
	}
	return waitErr
}
func discardUncapturedCommand(child *ownedChild) error {
	command := child.command
	killErr := command.Process.Kill()
	if errors.Is(killErr, os.ErrProcessDone) {
		killErr = nil
	}
	waitErr := command.Wait()
	// Startup has not resumed this suspended child, so it cannot have descendants.
	child.disposed = killErr == nil && command.ProcessState != nil
	var exit *exec.ExitError
	if errors.As(waitErr, &exit) {
		waitErr = nil
	}
	return errors.Join(killErr, waitErr)
}

func waitOwnedJobEmpty(job windows.Handle) error {
	// JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, class 1: an actual kernel count,
	// not PID polling. Keep the Job handle until every owned member has exited.
	var accounting struct {
		TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime int64
		TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses     uint32
	}
	query := windows.NewLazySystemDLL("kernel32.dll").NewProc("QueryInformationJobObject")
	deadline := time.Now().Add(5 * time.Second)
	for {
		result, _, err := query.Call(uintptr(job), 1, uintptr(unsafe.Pointer(&accounting)), unsafe.Sizeof(accounting), 0)
		if result == 0 {
			return fmt.Errorf("query owned Job exit: %w", err)
		}
		if accounting.ActiveProcesses == 0 {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("owned Job still has live members after termination")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
