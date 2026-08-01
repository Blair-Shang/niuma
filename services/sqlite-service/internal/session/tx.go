package session

import (
	"context"
	"fmt"
)

// TxState 是会话事务 / Auto-commit 状态（对齐 Navicat / DBeaver / IDEA 工具栏）。
type TxState struct {
	AutoCommit    bool `json:"autoCommit"`
	InTransaction bool `json:"inTransaction"`
}

// TxStateSnapshot 返回当前事务状态。
func (s *Session) TxStateSnapshot() TxState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return TxState{
		AutoCommit:    s.autoCommit,
		InTransaction: s.inTx,
	}
}

// IsAutoCommit 报告当前是否 Auto-commit。
func (s *Session) IsAutoCommit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.autoCommit
}

func (s *Session) markInTxAfterStatement() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.autoCommit {
		s.inTx = true
	}
}

// SetAutoCommit 切换 Auto-commit。开启时若有未提交事务则先 Rollback。
func (s *Session) SetAutoCommit(ctx context.Context, enabled bool) (TxState, error) {
	if s.DB == nil {
		return TxState{}, fmt.Errorf("sqlite: session closed")
	}
	s.CloseResultSet("")

	s.mu.Lock()
	busy := s.txBusy
	s.mu.Unlock()
	if busy {
		return TxState{}, fmt.Errorf("sqlite: connection busy")
	}

	if enabled {
		s.mu.Lock()
		inTx := s.inTx
		s.mu.Unlock()
		if inTx {
			if _, err := s.DB.ExecContext(ctx, "ROLLBACK"); err != nil {
				return TxState{}, fmt.Errorf("sqlite: rollback before auto-commit: %w", err)
			}
		}
		s.mu.Lock()
		s.autoCommit = true
		s.inTx = false
		s.mu.Unlock()
		return s.TxStateSnapshot(), nil
	}

	// 关闭 Auto-commit：显式 BEGIN（对齐 DBeaver 手动事务）。
	s.mu.Lock()
	already := !s.autoCommit
	s.mu.Unlock()
	if already {
		return s.TxStateSnapshot(), nil
	}
	if _, err := s.DB.ExecContext(ctx, "BEGIN"); err != nil {
		return TxState{}, fmt.Errorf("sqlite: begin: %w", err)
	}
	s.mu.Lock()
	s.autoCommit = false
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// Commit 提交当前事务并保持非 Auto-commit（再开 BEGIN）。
func (s *Session) Commit(ctx context.Context) (TxState, error) {
	if s.DB == nil {
		return TxState{}, fmt.Errorf("sqlite: session closed")
	}
	s.CloseResultSet("")
	s.mu.Lock()
	ac := s.autoCommit
	s.mu.Unlock()
	if ac {
		return s.TxStateSnapshot(), nil
	}
	if _, err := s.DB.ExecContext(ctx, "COMMIT"); err != nil {
		return TxState{}, fmt.Errorf("sqlite: commit: %w", err)
	}
	if _, err := s.DB.ExecContext(ctx, "BEGIN"); err != nil {
		s.mu.Lock()
		s.autoCommit = true
		s.inTx = false
		s.mu.Unlock()
		return TxState{}, fmt.Errorf("sqlite: begin after commit: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// Rollback 回滚当前事务并保持非 Auto-commit。
func (s *Session) Rollback(ctx context.Context) (TxState, error) {
	if s.DB == nil {
		return TxState{}, fmt.Errorf("sqlite: session closed")
	}
	s.CloseResultSet("")
	s.mu.Lock()
	ac := s.autoCommit
	s.mu.Unlock()
	if ac {
		return s.TxStateSnapshot(), nil
	}
	if _, err := s.DB.ExecContext(ctx, "ROLLBACK"); err != nil {
		return TxState{}, fmt.Errorf("sqlite: rollback: %w", err)
	}
	if _, err := s.DB.ExecContext(ctx, "BEGIN"); err != nil {
		s.mu.Lock()
		s.autoCommit = true
		s.inTx = false
		s.mu.Unlock()
		return TxState{}, fmt.Errorf("sqlite: begin after rollback: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}
