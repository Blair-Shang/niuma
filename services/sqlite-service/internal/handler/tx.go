package handler

import (
	"context"
	"encoding/json"
	"fmt"
)

func (d *Dispatcher) txGetState(ctx context.Context, req Request) Response {
	_ = ctx
	var params sessionIDParams
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
	return okResponse(req.ID, sess.TxStateSnapshot())
}

type txAutoCommitParams struct {
	SessionID  string `json:"sessionId"`
	AutoCommit bool   `json:"autoCommit"`
}

func (d *Dispatcher) txSetAutoCommit(ctx context.Context, req Request) Response {
	var params txAutoCommitParams
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
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, state)
}

func (d *Dispatcher) txCommit(ctx context.Context, req Request) Response {
	var params sessionIDParams
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
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, state)
}

func (d *Dispatcher) txRollback(ctx context.Context, req Request) Response {
	var params sessionIDParams
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
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, state)
}
