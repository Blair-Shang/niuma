package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/postgres-service/internal/session"
)

type txSessionParams struct {
	SessionID string `json:"sessionId"`
}

type txSetAutoCommitParams struct {
	SessionID  string `json:"sessionId"`
	AutoCommit bool   `json:"autoCommit"`
}

const (
	// MethodTxGetState 读取会话事务 / Auto-commit 状态。
	MethodTxGetState = "tx.getState"
	// MethodTxSetAutoCommit 切换 Auto-commit。
	MethodTxSetAutoCommit = "tx.setAutoCommit"
	// MethodTxCommit 提交当前事务。
	MethodTxCommit = "tx.commit"
	// MethodTxRollback 回滚当前事务。
	MethodTxRollback = "tx.rollback"
)

func (d *Dispatcher) txGetState(ctx context.Context, req Request) Response {
	_ = ctx
	var params txSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	state := sess.TxStateSnapshot()
	logOpInfo(MethodTxGetState, "session", params.SessionID, "autoCommit", state.AutoCommit, "inTx", state.InTransaction)
	return okResponse(req.ID, state)
}

func (d *Dispatcher) txSetAutoCommit(ctx context.Context, req Request) Response {
	var params txSetAutoCommitParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	state, err := sess.SetAutoCommit(ctx, params.AutoCommit)
	if err != nil {
		logOpWarn(MethodTxSetAutoCommit, err, "session", params.SessionID, "autoCommit", params.AutoCommit)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTxSetAutoCommit, "session", params.SessionID, "autoCommit", state.AutoCommit, "inTx", state.InTransaction)
	return okResponse(req.ID, state)
}

func (d *Dispatcher) txCommit(ctx context.Context, req Request) Response {
	var params txSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	state, err := sess.Commit(ctx)
	if err != nil {
		logOpWarn(MethodTxCommit, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTxCommit, "session", params.SessionID)
	return okResponse(req.ID, state)
}

func (d *Dispatcher) txRollback(ctx context.Context, req Request) Response {
	var params txSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	state, err := sess.Rollback(ctx)
	if err != nil {
		logOpWarn(MethodTxRollback, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTxRollback, "session", params.SessionID)
	return okResponse(req.ID, state)
}

// ensureSessionAllowsQueryDB 非 Auto-commit 时禁止切换到会话外短连库。
func ensureSessionAllowsQueryDB(sess *session.Session, ownDB bool) error {
	if sess == nil || sess.IsAutoCommit() {
		return nil
	}
	if ownDB {
		return fmt.Errorf("postgres: cannot use a different database while auto-commit is off")
	}
	return nil
}
