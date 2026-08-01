package session

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TxState 是会话事务 / Auto-commit 状态（对齐 Navicat / DBeaver / MySQL 工具栏）。
type TxState struct {
	AutoCommit    bool `json:"autoCommit"`
	InTransaction bool `json:"inTransaction"`
}

// TxStateSnapshot 返回当前事务状态（只读）。
// 未钉连接时视为 Auto-commit（与 mysql-service 一致）。
func (s *Session) TxStateSnapshot() TxState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return TxState{
		AutoCommit:    s.autoCommit || s.txConn == nil,
		InTransaction: s.inTx,
	}
}

// IsAutoCommit 报告当前是否按连接池 Auto-commit 模式执行。
func (s *Session) IsAutoCommit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.autoCommit || s.txConn == nil
}

// acquireExecConn 取得执行用连接。
// sessionOwned=true 时调用方不得 Release 到池；release 在语句/游标结束后调用以清除 txBusy。
func (s *Session) acquireExecConn(ctx context.Context, pool *pgxpool.Pool) (conn *pgxpool.Conn, sessionOwned bool, release func(), err error) {
	s.mu.Lock()
	useTx := !s.autoCommit && s.txConn != nil
	if useTx {
		if s.txBusy {
			s.mu.Unlock()
			return nil, false, nil, fmt.Errorf("kingbase: transaction connection busy (close open result cursor first)")
		}
		conn = s.txConn
		s.txBusy = true
		s.mu.Unlock()
		return conn, true, func() {
			s.mu.Lock()
			s.txBusy = false
			s.mu.Unlock()
		}, nil
	}
	s.mu.Unlock()

	if pool == nil {
		return nil, false, nil, fmt.Errorf("kingbase: pool required")
	}
	conn, err = pool.Acquire(ctx)
	if err != nil {
		return nil, false, nil, fmt.Errorf("kingbase: acquire: %w", err)
	}
	return conn, false, nil, nil
}

// beginTxIfNeeded 在非 Auto-commit 且尚未 BEGIN 时显式开启事务（PG 语义）。
func (s *Session) beginTxIfNeeded(ctx context.Context, conn *pgxpool.Conn) error {
	if conn == nil {
		return nil
	}
	s.mu.Lock()
	need := !s.autoCommit && s.txConn != nil && conn == s.txConn && !s.inTx
	s.mu.Unlock()
	if !need {
		return nil
	}
	if _, err := conn.Exec(ctx, "BEGIN"); err != nil {
		return fmt.Errorf("kingbase: begin: %w", err)
	}
	s.mu.Lock()
	s.inTx = true
	s.mu.Unlock()
	return nil
}

// markInTxAfterStatement 在非 Auto-commit 下确保已标记进入事务。
func (s *Session) markInTxAfterStatement() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.autoCommit && s.txConn != nil {
		s.inTx = true
	}
}

// SetAutoCommit 切换 Auto-commit。开启时若有未提交事务则先 Rollback。
func (s *Session) SetAutoCommit(ctx context.Context, enabled bool) (TxState, error) {
	if s.Pool == nil {
		return TxState{}, fmt.Errorf("kingbase: session closed")
	}

	s.CloseResultSet("")

	s.mu.Lock()
	busy := s.txBusy
	s.mu.Unlock()
	if busy {
		return TxState{}, fmt.Errorf("kingbase: transaction connection busy")
	}

	if enabled {
		return s.ensureAutoCommitOn(ctx)
	}
	return s.ensureAutoCommitOff(ctx)
}

func (s *Session) ensureAutoCommitOn(ctx context.Context) (TxState, error) {
	s.mu.Lock()
	conn := s.txConn
	inTx := s.inTx
	s.mu.Unlock()

	if conn != nil {
		if inTx {
			if _, err := conn.Exec(ctx, "ROLLBACK"); err != nil {
				return TxState{}, fmt.Errorf("kingbase: rollback before auto-commit: %w", err)
			}
		}
		conn.Release()
	}

	s.mu.Lock()
	s.txConn = nil
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

func (s *Session) ensureAutoCommitOff(ctx context.Context) (TxState, error) {
	s.mu.Lock()
	if s.txConn != nil {
		s.autoCommit = false
		s.mu.Unlock()
		return s.TxStateSnapshot(), nil
	}
	pool := s.Pool
	s.mu.Unlock()

	if pool == nil {
		return TxState{}, fmt.Errorf("kingbase: session closed")
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return TxState{}, fmt.Errorf("kingbase: acquire tx conn: %w", err)
	}

	s.mu.Lock()
	s.txConn = conn
	s.autoCommit = false
	s.inTx = false
	s.txBusy = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// Commit 提交当前事务（仅非 Auto-commit）。
func (s *Session) Commit(ctx context.Context) (TxState, error) {
	s.CloseResultSet("")

	s.mu.Lock()
	conn := s.txConn
	busy := s.txBusy
	auto := s.autoCommit || conn == nil
	s.mu.Unlock()
	if auto {
		return TxState{AutoCommit: true}, fmt.Errorf("kingbase: auto-commit is on; nothing to commit")
	}
	if busy {
		return TxState{}, fmt.Errorf("kingbase: transaction connection busy")
	}
	if _, err := conn.Exec(ctx, "COMMIT"); err != nil {
		return TxState{}, fmt.Errorf("kingbase: commit: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// Rollback 回滚当前事务（仅非 Auto-commit）。
func (s *Session) Rollback(ctx context.Context) (TxState, error) {
	s.CloseResultSet("")

	s.mu.Lock()
	conn := s.txConn
	busy := s.txBusy
	auto := s.autoCommit || conn == nil
	s.mu.Unlock()
	if auto {
		return TxState{AutoCommit: true}, fmt.Errorf("kingbase: auto-commit is on; nothing to rollback")
	}
	if busy {
		return TxState{}, fmt.Errorf("kingbase: transaction connection busy")
	}
	if _, err := conn.Exec(ctx, "ROLLBACK"); err != nil {
		return TxState{}, fmt.Errorf("kingbase: rollback: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// releaseTxConnLocked 关闭钉住的事务连接（调用方持锁）。
func (s *Session) releaseTxConnLocked() {
	if s.txConn != nil {
		if s.inTx {
			_, _ = s.txConn.Exec(context.Background(), "ROLLBACK")
		}
		s.txConn.Release()
		s.txConn = nil
	}
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
}
