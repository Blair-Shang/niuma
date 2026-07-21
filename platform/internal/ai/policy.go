package ai

import (
	"fmt"
	"strings"
	"sync"
)

// PolicyDecision 是用户对待确认工具的决定。
const (
	PolicyDecisionApprove = "approve"
	PolicyDecisionReject  = "reject"
)

// Risk levels for MCP tools / invocations.
const (
	RiskRead      = "read"
	RiskWrite     = "write"
	RiskDangerous = "dangerous"
)

type pendingWait struct {
	runID string
	ch    chan bool // true = approve
}

// policyGate 在 Agent Loop 中阻塞等待用户确认（write / dangerous）。
type policyGate struct {
	mu      sync.Mutex
	waiters map[string]*pendingWait // invocationID → wait
}

func newPolicyGate() *policyGate {
	return &policyGate{waiters: make(map[string]*pendingWait)}
}

func (g *policyGate) register(invocationID, runID string) <-chan bool {
	if g == nil {
		ch := make(chan bool, 1)
		ch <- false
		return ch
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if old, ok := g.waiters[invocationID]; ok {
		select {
		case old.ch <- false:
		default:
		}
		delete(g.waiters, invocationID)
	}
	ch := make(chan bool, 1)
	g.waiters[invocationID] = &pendingWait{runID: runID, ch: ch}
	return ch
}

// decide 完成一次确认；找不到 pending 时返回 false。
func (g *policyGate) decide(invocationID string, approve bool) bool {
	if g == nil || invocationID == "" {
		return false
	}
	g.mu.Lock()
	w, ok := g.waiters[invocationID]
	if ok {
		delete(g.waiters, invocationID)
	}
	g.mu.Unlock()
	if !ok {
		return false
	}
	w.ch <- approve
	return true
}

// cancel 移除单个 waiter（ctx 取消时由等待方调用，避免泄漏）。
func (g *policyGate) cancel(invocationID string) {
	if g == nil || invocationID == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.waiters, invocationID)
}

// rejectRun 拒绝某 run 下全部待确认项（Cancel 时调用）。
func (g *policyGate) rejectRun(runID string) {
	if g == nil || runID == "" {
		return
	}
	g.mu.Lock()
	var victims []*pendingWait
	for id, w := range g.waiters {
		if w.runID == runID {
			victims = append(victims, w)
			delete(g.waiters, id)
		}
	}
	g.mu.Unlock()
	for _, w := range victims {
		select {
		case w.ch <- false:
		default:
		}
	}
}

// listPending 返回某 run（空则全部）的待确认 invocationId。
func (g *policyGate) listPending(runID string) []string {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]string, 0, len(g.waiters))
	for id, w := range g.waiters {
		if runID == "" || w.runID == runID {
			out = append(out, id)
		}
	}
	return out
}

// NormalizeRiskLevel 规范化风险等级；未知值视为 read。
func NormalizeRiskLevel(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case RiskWrite:
		return RiskWrite
	case RiskDangerous:
		return RiskDangerous
	default:
		return RiskRead
	}
}

// RequiresConfirm 为 write / dangerous 时需要用户确认。
func RequiresConfirm(risk string) bool {
	r := NormalizeRiskLevel(risk)
	return r == RiskWrite || r == RiskDangerous
}

// InferToolRisk 按工具名启发式推断风险（发现缓存默认值；用户可在 Settings 覆盖）。
func InferToolRisk(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return RiskRead
	}
	if strings.Contains(n, "readonly") || strings.Contains(n, "read_only") {
		return RiskRead
	}
	dangerousHints := []string{
		"shell", "exec_command", "execute_command", "run_command",
		"drop_database", "drop_schema", "format_disk",
	}
	for _, k := range dangerousHints {
		if strings.Contains(n, k) {
			return RiskDangerous
		}
	}
	writeHints := []string{
		"insert", "update", "delete", "drop", "create", "alter", "truncate",
		"write", "apply", "grant", "revoke", "upsert", "replace",
		"execute_sql", "run_sql", "exec_sql",
	}
	for _, k := range writeHints {
		if strings.Contains(n, k) {
			return RiskWrite
		}
	}
	return RiskRead
}

// ResolveToolRisk 优先用缓存上的 risk_level，空则启发式推断。
func ResolveToolRisk(stored, toolName string) string {
	if strings.TrimSpace(stored) != "" {
		return NormalizeRiskLevel(stored)
	}
	return InferToolRisk(toolName)
}

// ConfirmPolicy 处理 platform.ai.policy.confirm。
func (s *Service) ConfirmPolicy(invocationID, decision string) error {
	if s == nil || s.policy == nil {
		return fmt.Errorf("ai: policy unavailable")
	}
	invocationID = strings.TrimSpace(invocationID)
	if invocationID == "" {
		return fmt.Errorf("ai: invocationId required")
	}
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case PolicyDecisionApprove:
		if !s.policy.decide(invocationID, true) {
			return fmt.Errorf("ai: no pending invocation %q", invocationID)
		}
		return nil
	case PolicyDecisionReject:
		if !s.policy.decide(invocationID, false) {
			return fmt.Errorf("ai: no pending invocation %q", invocationID)
		}
		return nil
	default:
		return fmt.Errorf("ai: decision must be approve or reject")
	}
}

// ListPendingPolicy 处理 platform.ai.policy.listPending。
func (s *Service) ListPendingPolicy(runID string) []string {
	if s == nil || s.policy == nil {
		return nil
	}
	return s.policy.listPending(strings.TrimSpace(runID))
}
