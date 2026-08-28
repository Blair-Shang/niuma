package supervisor

import (
	"context"
	"os/exec"
	"runtime"
	"testing"
	"time"
)

func TestIsProcessAlive(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	cmd := exec.Command("cmd", "/c", "timeout", "/t", "2", "/nobreak")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	if !isProcessAlive(pid) {
		t.Fatalf("expected pid %d alive", pid)
	}
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !isProcessAlive(pid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected pid %d dead", pid)
}

func shortExitCmd() *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.Command("cmd", "/c", "exit", "0")
	}
	return exec.Command("true")
}

func testSupervisor() *Supervisor {
	return &Supervisor{
		stop:          make(chan struct{}),
		spawned:       make(map[string]*exec.Cmd),
		startedAt:     make(map[string]time.Time),
		restartDelay:  make(map[string]time.Duration),
		restartCancel: make(map[string]context.CancelFunc),
	}
}

func TestWatchChildClearsSpawned(t *testing.T) {
	sup := &Supervisor{spawned: make(map[string]*exec.Cmd), shuttingDown: true}
	cmd := shortExitCmd()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	sup.spawned["test"] = cmd
	sup.watchChild("test", cmd)
	if _, ok := sup.spawned["test"]; ok {
		t.Fatal("spawned map should be cleared after exit")
	}
}

func TestWatchChild_ShutdownCancelsRestart(t *testing.T) {
	sup := testSupervisor()
	cmd := shortExitCmd()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	sup.spawned["test"] = cmd
	done := make(chan struct{})
	go func() {
		sup.watchChild("test", cmd)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("watchChild hung")
	}

	sup.mu.Lock()
	_, scheduled := sup.restartCancel["test"]
	sup.mu.Unlock()
	if !scheduled {
		t.Fatal("expected pending restart")
	}

	sup.Shutdown()

	sup.mu.Lock()
	defer sup.mu.Unlock()
	if !sup.shuttingDown {
		t.Fatal("expected shuttingDown")
	}
	if len(sup.restartCancel) != 0 {
		t.Fatal("pending restart not cancelled")
	}
}
