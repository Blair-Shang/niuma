// Package supervisor 由 platform-core 拉起并守护 Layer-1 能力服务进程。
package supervisor

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// listenProbeMs 是 WaitNamedPipe / 等价探活的上限。仅用于冷启动或遗留进程判断，
// 不得出现在已登记服务的热路径上（曾导致全部能力 RPC 串行等待）。
const listenProbeMs = 200

// EnvProvider 在拉起能力服务前附加环境变量（由 manifest env_from_component 驱动）。
// 返回项格式为 KEY=VALUE；可为 nil。
type EnvProvider func(ctx context.Context, serviceID string) []string

// Supervisor 管理子服务进程的懒启动、崩溃拉起与管道探活。
type Supervisor struct {
	servicesDir string
	manifests   map[string]*Manifest
	envProvider EnvProvider
	sink        EventSink
	stop        chan struct{}

	mu sync.Mutex
	// ensureGroup 按 serviceID 合并并发 Ensure：同一服务只拉起一次，不同服务并行。
	ensureGroup  singleflight.Group
	shuttingDown bool
	spawned      map[string]*exec.Cmd
	// spawnEnvFingerprint 记录上次成功 spawn 时 EnvProvider 的指纹；变更则强制重启。
	spawnEnvFingerprint map[string]string
	startedAt           map[string]time.Time
	restartDelay        map[string]time.Duration
	restartCancel       map[string]context.CancelFunc
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
		servicesDir:         servicesDir,
		manifests:           manifests,
		stop:                make(chan struct{}),
		spawned:             make(map[string]*exec.Cmd),
		spawnEnvFingerprint: make(map[string]string),
		startedAt:           make(map[string]time.Time),
		restartDelay:        make(map[string]time.Duration),
		restartCancel:       make(map[string]context.CancelFunc),
	}, nil
}

// SetEnvProvider 设置子进程环境注入回调（可在 New 之后调用）。
func (s *Supervisor) SetEnvProvider(p EnvProvider) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.envProvider = p
}

// SetEventSink 设置进程退出时的 UI 通知回调（可为 nil）。
func (s *Supervisor) SetEventSink(sink EventSink) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sink = sink
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
// 已登记且环境指纹未变时立即返回，不探管道、不扫进程。同一服务的并发
// Ensure 合并为一次拉起；不同服务并行，互不等待。s.mu 只保护登记表，
// 进程枚举 / 等管道 / 杀孤儿等慢操作不持锁。
// 冷启动（管道未监听）跳过全机进程扫描。仅当管道已被占用才终止同路径孤儿。
// 若 EnvProvider 指纹相对上次 spawn 已变化（如用户改了组件路径），则强制重启。
func (s *Supervisor) Ensure(ctx context.Context, serviceID string) error {
	m, err := s.Manifest(serviceID)
	if err != nil {
		return err
	}
	addr := m.IPCAddress()
	envExtra, envFP := s.resolveEnv(ctx, serviceID)

	// 热路径：本会话已拉起则立刻返回，避免探管道/扫进程把其它连接拖住。
	if s.isTrackedReady(serviceID, envFP) {
		return nil
	}

	_, err, _ = s.ensureGroup.Do(serviceID, func() (any, error) {
		return nil, s.ensureOne(ctx, m, addr, envExtra, envFP)
	})
	return err
}

// isTrackedReady 报告本进程已拉起该服务且环境指纹未变。
// 只看登记表与进程是否存活，不 Dial / WaitNamedPipe，可在任意 RPC 上安全调用。
func (s *Supervisor) isTrackedReady(serviceID, envFP string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.shuttingDown {
		return false
	}
	cmd := s.spawned[serviceID]
	if cmd == nil || cmd.Process == nil || !isProcessAlive(cmd.Process.Pid) {
		return false
	}
	prev, ok := s.spawnEnvFingerprint[serviceID]
	return ok && prev == envFP
}

// ensureOne 实际执行一次拉起或复用。由 ensureGroup 保证同一 serviceID 串行。
// 慢操作（探管道、杀孤儿、等就绪）均在 s.mu 之外，避免堵住其它服务的 Ensure。
func (s *Supervisor) ensureOne(ctx context.Context, m *Manifest, addr string, envExtra []string, envFP string) error {
	serviceID := m.ID
	if s.isTrackedReady(serviceID, envFP) {
		return nil
	}
	if s.isShuttingDown() {
		return fmt.Errorf("supervisor: shutting down")
	}

	// 仅冷启动/遗留进程需要探活；已登记服务走 isTrackedReady，不会到这里。
	listening := s.isPipeListening(addr)
	if listening {
		s.mu.Lock()
		prev, ok := s.spawnEnvFingerprint[serviceID]
		cmd := s.spawned[serviceID]
		s.mu.Unlock()
		if ok && prev == envFP {
			return nil
		}
		// 环境配置已变，或管道被遗留进程占用：停掉后再拉起。
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
			s.mu.Lock()
			s.forgetSpawnedLocked(serviceID, cmd)
			s.mu.Unlock()
		} else if exe, exeErr := s.resolveExecutable(m); exeErr == nil {
			terminateStaleProcessesAtExe(exe)
		}
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) && s.isPipeListening(addr) {
			time.Sleep(50 * time.Millisecond)
		}
	}

	s.mu.Lock()
	cmd := s.spawned[serviceID]
	s.mu.Unlock()
	if cmd != nil {
		if cmd.Process != nil && isProcessAlive(cmd.Process.Pid) {
			s.mu.Lock()
			prev, ok := s.spawnEnvFingerprint[serviceID]
			s.mu.Unlock()
			if ok && prev == envFP {
				return s.waitPipe(ctx, addr, 8*time.Second)
			}
			_ = cmd.Process.Kill()
			s.mu.Lock()
			s.forgetSpawnedLocked(serviceID, cmd)
			s.mu.Unlock()
		} else {
			s.mu.Lock()
			s.forgetSpawnedLocked(serviceID, cmd)
			s.mu.Unlock()
		}
	}

	exe, err := s.resolveExecutable(m)
	if err != nil {
		return err
	}
	// 冷启动管道未占用时不必枚举全机进程；有监听残留才在上面的分支杀孤儿。

	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return fmt.Errorf("supervisor: shutting down")
	}
	started, err := s.startLocked(serviceID, exe, envExtra)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	s.spawned[serviceID] = started
	s.spawnEnvFingerprint[serviceID] = envFP
	s.mu.Unlock()
	return s.waitPipe(ctx, addr, 8*time.Second)
}

// isShuttingDown 返回 Shutdown 是否已开始。与登记表同一把锁，避免拉起与退出交错。
func (s *Supervisor) isShuttingDown() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.shuttingDown
}

func (s *Supervisor) resolveEnv(ctx context.Context, serviceID string) (extra []string, fingerprint string) {
	s.mu.Lock()
	provider := s.envProvider
	s.mu.Unlock()
	if provider == nil {
		return nil, ""
	}
	extra = provider(ctx, serviceID)
	if len(extra) == 0 {
		return nil, ""
	}
	// 稳定指纹：排序后拼接
	sorted := append([]string(nil), extra...)
	sort.Strings(sorted)
	return extra, strings.Join(sorted, "\n")
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

func (s *Supervisor) startLocked(serviceID, exe string, envExtra []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(context.Background(), exe)
	cmd.Dir = s.servicesDir
	if len(envExtra) > 0 {
		cmd.Env = append(os.Environ(), envExtra...)
	}
	if attr := childSysProcAttr(); attr != nil {
		cmd.SysProcAttr = attr
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("supervisor: start %s: %w", serviceID, err)
	}
	if cmd.Process != nil {
		if err := assignChildToJob(cmd.Process.Pid); err != nil {
			slog.Warn("supervisor: assign to job failed", "service", serviceID, "err", err)
		}
	}
	// Wait 只在 watchChild 调一次；Shutdown 只 Kill + 探活，禁止再 Wait。
	go s.watchChild(serviceID, cmd)
	s.startedAt[serviceID] = time.Now()
	slog.Info("supervisor: spawned", "service", serviceID, "pid", cmd.Process.Pid)
	return cmd, nil
}

func (s *Supervisor) watchChild(serviceID string, cmd *exec.Cmd) {
	_ = cmd.Wait()
	s.mu.Lock()
	shutting := s.shuttingDown
	stillTracked := false
	if cur, ok := s.spawned[serviceID]; ok && cur == cmd {
		delete(s.spawned, serviceID)
		stillTracked = true
	}
	lived := time.Duration(0)
	if t, ok := s.startedAt[serviceID]; ok && !t.IsZero() {
		lived = time.Since(t)
	}
	prevDelay := s.restartDelay[serviceID]
	sink := s.sink
	s.mu.Unlock()

	slog.Info("supervisor: exited", "service", serviceID, "tracked", stillTracked, "livedMs", lived.Milliseconds())
	if shutting {
		// 主进程正在退出：只收尸，不 scheduleRestart，避免关应用时又拉起一份。
		return
	}

	s.emitLost(sink, serviceID, "capability service exited")
	if !stillTracked {
		return
	}
	delay := nextRestartDelay(prevDelay, lived)
	s.mu.Lock()
	if s.restartDelay == nil {
		s.restartDelay = make(map[string]time.Duration)
	}
	s.restartDelay[serviceID] = delay
	s.mu.Unlock()
	s.scheduleRestart(serviceID, delay)
}

func (s *Supervisor) emitLost(sink EventSink, serviceID, message string) {
	if sink == nil {
		return
	}
	ns := ""
	if m, err := s.Manifest(serviceID); err == nil && m != nil {
		ns = strings.TrimSpace(m.Bridge.Namespace)
	}
	for _, ev := range lostEvents(serviceID, ns, message) {
		sink(ev)
	}
}

func (s *Supervisor) scheduleRestart(serviceID string, delay time.Duration) {
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return
	}
	if s.restartCancel == nil {
		s.restartCancel = make(map[string]context.CancelFunc)
	}
	if cancel, ok := s.restartCancel[serviceID]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.restartCancel[serviceID] = cancel
	if s.stop == nil {
		s.stop = make(chan struct{})
	}
	stop := s.stop
	s.mu.Unlock()

	slog.Info("supervisor: respawn scheduled", "service", serviceID, "delay", delay.String())
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-stop:
			return
		case <-timer.C:
		}
		s.mu.Lock()
		delete(s.restartCancel, serviceID)
		shutting := s.shuttingDown
		s.mu.Unlock()
		if shutting {
			return
		}
		ensureCtx, ensureCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ensureCancel()
		if err := s.Ensure(ensureCtx, serviceID); err != nil {
			slog.Error("supervisor: respawn failed", "service", serviceID, "err", err)
			s.mu.Lock()
			next := nextRestartDelay(s.restartDelay[serviceID], 0)
			s.restartDelay[serviceID] = next
			s.mu.Unlock()
			s.scheduleRestart(serviceID, next)
		}
	}()
}

func (s *Supervisor) forgetSpawnedLocked(serviceID string, cmd *exec.Cmd) {
	if cur, ok := s.spawned[serviceID]; ok && cur == cmd {
		delete(s.spawned, serviceID)
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
//
// 先置 shuttingDown 再 Kill，watchChild 不会 scheduleRestart，因此不会在退出时重复拉起。
// Wait 仍由 watchChild 负责（exec.Cmd.Wait 只能调用一次）。超时仍存活的进程靠
// Job KILL_ON_JOB_CLOSE（Windows）或父进程退出后的 PDEATHSIG（Linux）收掉。
func (s *Supervisor) Shutdown() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if s.shuttingDown {
		s.mu.Unlock()
		return
	}
	s.shuttingDown = true
	close(s.stop)
	for _, cancel := range s.restartCancel {
		cancel()
	}
	s.restartCancel = make(map[string]context.CancelFunc)
	cmds := make([]*exec.Cmd, 0, len(s.spawned))
	for _, cmd := range s.spawned {
		cmds = append(cmds, cmd)
	}
	s.spawned = make(map[string]*exec.Cmd)
	s.mu.Unlock()

	for _, cmd := range cmds {
		if cmd == nil || cmd.Process == nil {
			continue
		}
		if err := cmd.Process.Kill(); err != nil {
			slog.Warn("supervisor: kill failed", "err", err)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		alive := false
		for _, cmd := range cmds {
			if cmd != nil && cmd.Process != nil && isProcessAlive(cmd.Process.Pid) {
				alive = true
				break
			}
		}
		if !alive {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	closeChildJob()
}
