package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// TxState 是会话事务 / Auto-commit 状态（对齐 Navicat / DBeaver 工具栏）。
type TxState struct {
	AutoCommit    bool `json:"autoCommit"`
	InTransaction bool `json:"inTransaction"`
}

// TxStateSnapshot 返回当前事务状态（只读）。
func (s *Session) TxStateSnapshot() TxState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return TxState{
		AutoCommit:    s.autoCommit || s.txConn == nil,
		InTransaction: s.inTx,
	}
}

// acquireExecConn 取得执行用连接。
// sessionOwned=true 时调用方不得 Close 连接；release 在语句/游标结束后调用以清除 txBusy。
func (s *Session) acquireExecConn(ctx context.Context, db *sql.DB) (conn *sql.Conn, sessionOwned bool, release func(), err error) {
	s.mu.Lock()
	useTx := !s.autoCommit && s.txConn != nil
	if useTx {
		if s.txBusy {
			s.mu.Unlock()
			return nil, false, nil, fmt.Errorf("mysql: transaction connection busy (close open result cursor first)")
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

	if db == nil {
		return nil, false, nil, fmt.Errorf("mysql: db required")
	}
	conn, err = db.Conn(ctx)
	if err != nil {
		return nil, false, nil, fmt.Errorf("mysql: acquire: %w", err)
	}
	return conn, false, nil, nil
}

// markInTxAfterStatement 在非 Auto-commit 下标记进入事务。
func (s *Session) markInTxAfterStatement() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.autoCommit && s.txConn != nil {
		s.inTx = true
	}
}

// SetAutoCommit 切换 Auto-commit。开启时若有未提交事务则先 Rollback（运维工具偏安全）。
func (s *Session) SetAutoCommit(ctx context.Context, enabled bool) (TxState, error) {
	if s.DB == nil {
		return TxState{}, fmt.Errorf("mysql: session closed")
	}

	s.CloseResultSet("")

	s.mu.Lock()
	busy := s.txBusy
	s.mu.Unlock()
	if busy {
		return TxState{}, fmt.Errorf("mysql: transaction connection busy")
	}

	if enabled {
		return s.ensureAutoCommitOn(ctx)
	}
	return s.ensureAutoCommitOff(ctx)
}

// IsAutoCommit 报告当前是否按连接池 Auto-commit 模式执行。
func (s *Session) IsAutoCommit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.autoCommit || s.txConn == nil
}

func (s *Session) ensureAutoCommitOn(ctx context.Context) (TxState, error) {
	s.mu.Lock()
	conn := s.txConn
	inTx := s.inTx
	s.mu.Unlock()

	if conn != nil {
		if inTx {
			if _, err := conn.ExecContext(ctx, "ROLLBACK"); err != nil {
				return TxState{}, fmt.Errorf("mysql: rollback before auto-commit: %w", err)
			}
		}
		if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
			return TxState{}, fmt.Errorf("mysql: set autocommit=1: %w", err)
		}
		_ = conn.Close()
	}

	s.mu.Lock()
	s.txConn = nil
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
	s.txDatabase = ""
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
	s.mu.Unlock()

	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return TxState{}, fmt.Errorf("mysql: acquire tx conn: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "SET autocommit=0"); err != nil {
		_ = conn.Close()
		return TxState{}, fmt.Errorf("mysql: set autocommit=0: %w", err)
	}

	defaultDB := s.Params.Options.DatabaseOrEmpty()

	s.mu.Lock()
	s.txConn = conn
	s.autoCommit = false
	s.inTx = false
	s.txBusy = false
	s.txDatabase = defaultDB
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
		return TxState{AutoCommit: true}, fmt.Errorf("mysql: auto-commit is on; nothing to commit")
	}
	if busy {
		return TxState{}, fmt.Errorf("mysql: transaction connection busy")
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return TxState{}, fmt.Errorf("mysql: commit: %w", err)
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
		return TxState{AutoCommit: true}, fmt.Errorf("mysql: auto-commit is on; nothing to rollback")
	}
	if busy {
		return TxState{}, fmt.Errorf("mysql: transaction connection busy")
	}
	if _, err := conn.ExecContext(ctx, "ROLLBACK"); err != nil {
		return TxState{}, fmt.Errorf("mysql: rollback: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// releaseTxConnLocked 关闭钉住的事务连接（调用方持锁）。
func (s *Session) releaseTxConnLocked() {
	if s.txConn != nil {
		_ = s.txConn.Close()
		s.txConn = nil
	}
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
	s.txDatabase = ""
}

// ensureConnDatabase 在连接上切换到目标库。
// sessionOwned 时跳过与 txDatabase 相同的 USE，并回写缓存。
func (s *Session) ensureConnDatabase(ctx context.Context, conn *sql.Conn, sessionOwned bool, database string) error {
	database = strings.TrimSpace(database)
	if database == "" || conn == nil {
		return nil
	}
	if sessionOwned {
		s.mu.Lock()
		current := s.txDatabase
		s.mu.Unlock()
		if strings.EqualFold(current, database) {
			return nil
		}
	}
	q := "USE " + quoteIdent(database)
	if _, err := conn.ExecContext(ctx, q); err != nil {
		return fmt.Errorf("mysql: use database %s: %w", database, err)
	}
	if sessionOwned {
		s.mu.Lock()
		s.txDatabase = database
		s.mu.Unlock()
	}
	return nil
}

// quoteIdent 用反引号包裹 MySQL 标识符。
func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}
