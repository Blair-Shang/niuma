package loop

import (
	"fmt"
	"strings"

	"niuma/platform/internal/ai/tool"
)

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
	case tool.PolicyDecisionApprove:
		if !s.policy.Decide(invocationID, true) {
			return fmt.Errorf("ai: no pending invocation %q", invocationID)
		}
		return nil
	case tool.PolicyDecisionReject:
		if !s.policy.Decide(invocationID, false) {
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
	return s.policy.ListPending(strings.TrimSpace(runID))
}
