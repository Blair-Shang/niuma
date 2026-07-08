// Package supervisor 由 platform-core 拉起并守护 Layer-1 能力服务进程。
package supervisor

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

const listenProbeMs = 200

// Supervisor 管理子服务进程的懒启动与管道探活。
type Supervisor struct {
	servicesDir string
	manifests   map[string]*Manifest
	mu          sync.Mutex
	spawned     map[string]*exec.Cmd
}

// New 创建 Supervisor 并加载 manifests。
func New(servicesDir string) (*Supervisor, error) {
	manifests, err := LoadManifests(servicesDir)
	if err != nil {
		return nil, err
	}
	if err := initChildJob(); err != nil {
		slog.Warn("supervisor: child job object init failed", "err", err)
	}
	return &Supervisor{
		servicesDir: servicesDir,
		manifests:   manifests,
		spawned:     make(map[string]*exec.Cmd),
	}, nil
}

// findServicesRoot 从可执行文件所在目录向上查找含 manifests/ 的 services 根。
func findServicesRoot(start string) (string, error) {
	dir := start
	for i := 0; i < 8; i++ {
		if _, statErr := os.Stat(filepath.Join(dir, "manifests")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("supervisor: services dir not found near %s", start)
}

// ResolveServicesDir 从当前可执行文件向上查找含 manifests/ 的 services 根目录。
//
// 约定：能力服务为 <services>/bin/niuma-<role>[.exe]；壳层为独立 niuma[.exe]。
func ResolveServicesDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("supervisor: resolve executable: %w", err)
	}
	return findServicesRoot(filepath.Dir(exe))
}

// AllManifests 返回已加载的全部能力服务 manifest（不含顺序保证）。
func (s *Supervisor) AllManifests() []*Manifest {
	out := make([]*Manifest, 0, len(s.manifests))
	for _, m := range s.manifests {
		out = append(out, m)
	}
	return out
}

// Manifest 返回指定服务 id 的 manifest。
func (s *Supervisor) Manifest(serviceID string) (*Manifest, error) {
	m, ok := s.manifests[serviceID]
	if !ok {
		return nil, fmt.Errorf("supervisor: manifest not found: %s", serviceID)
	}
	return m, nil
}

// Ensure 确保指定能力服务已启动且 IPC 在监听。
//
// 管道已就绪则直接复用（含上次会话遗留的健康进程）。子进程被误杀或卡死时，
// 清理登记并重新拉起；spawn 前会终止同路径的孤儿进程以免管道名冲突。
func (s *Supervisor) Ensure(ctx context.Context, serviceID string) error {
	m, err := s.Manifest(serviceID)
	if err != nil {
		return err
	}
	addr := m.IPCAddress()

	if s.isPipeListening(addr) {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isPipeListening(addr) {
		return nil
	}

	if cmd := s.spawned[serviceID]; cmd != nil {
		if cmd.Process != nil && isProcessAlive(cmd.Process.Pid) {
			return s.waitPipe(ctx, addr, 8*time.Second)
		}
		s.forgetSpawnedLocked(serviceID, cmd)
	}

	exe, err := s.resolveExecutable(m)
	if err != nil {
		return err
	}
	terminateStaleProcessesAtExe(exe)

	cmd, err := s.startLocked(serviceID, exe)
	if err != nil {
		return err
	}
	s.spawned[serviceID] = cmd
	return s.waitPipe(ctx, addr, 8*time.Second)
}

func (s *Supervisor) resolveExecutable(m *Manifest) (string, error) {
	exe := m.ExecutablePath(s.servicesDir)
	if abs, absErr := filepath.Abs(exe); absErr == nil {
		exe = abs
	}
	if _, statErr := os.Stat(exe); statErr != nil {
		return "", fmt.Errorf("supervisor: service binary not found at %s", exe)
	}
	return exe, nil
}

func (s *Supervisor) startLocked(serviceID, exe string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(context.Background(), exe)
	cmd.Dir = s.servicesDir
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = hiddenWindowSysProcAttr()
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("supervisor: start %s: %w", serviceID, err)
	}
	if cmd.Process != nil {
		if err := assignChildToJob(cmd.Process.Pid); err != nil {
			slog.Warn("supervisor: assign to job failed", "service", serviceID, "err", err)
		}
	}
	go s.watchChild(serviceID, cmd)
	slog.Info("supervisor: spawned", "service", serviceID, "pid", cmd.Process.Pid)
	return cmd, nil
}

func (s *Supervisor) watchChild(serviceID string, cmd *exec.Cmd) {
	_ = cmd.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	if cur, ok := s.spawned[serviceID]; ok && cur == cmd {
		delete(s.spawned, serviceID)
		slog.Info("supervisor: exited", "service", serviceID)
	}
}

func (s *Supervisor) forgetSpawnedLocked(serviceID string, cmd *exec.Cmd) {
	if cur, ok := s.spawned[serviceID]; ok && cur == cmd {
		delete(s.spawned, serviceID)
	}
	if cmd != nil && cmd.Process != nil {
		_, _ = cmd.Process.Wait()
	}
}

func (s *Supervisor) isPipeListening(addr string) bool {
	return waitNamedPipeAvailable(addr)
}

func (s *Supervisor) waitPipe(ctx context.Context, addr string, within time.Duration) error {
	deadline := time.Now().Add(within)
	step := 50 * time.Millisecond
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if s.isPipeListening(addr) {
			return nil
		}
		time.Sleep(step)
	}
	return fmt.Errorf("supervisor: pipe not ready: %s", addr)
}

// Shutdown 终止本进程会话内由 supervisor 拉起的全部能力服务（platform 退出时调用）。
func (s *Supervisor) Shutdown() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, cmd := range s.spawned {
		if cmd == nil || cmd.Process == nil {
			continue
		}
		if err := cmd.Process.Kill(); err != nil {
			slog.Warn("supervisor: kill failed", "service", id, "err", err)
		}
		_, _ = cmd.Process.Wait()
	}
	s.spawned = make(map[string]*exec.Cmd)
	closeChildJob()
}
