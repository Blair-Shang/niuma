package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/dialect"
	"niuma/services/sqlite-service/internal/session"
)

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	applyHostAddressFallback(req.Params, &params)
	db, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionOpen, err, "file", params.ResolvedFilePath())
		return errorResponse(req.ID, err.Error())
	}
	profile, perr := dialect.Probe(ctx, db, dialect.ProbeOptions{
		ReadOnly:    params.Options.ReadOnly,
		JournalMode: params.Options.JournalMode,
	})
	if perr != nil {
		_ = db.Close()
		logOpError(MethodSessionOpen, perr, "file", params.ResolvedFilePath())
		return errorResponse(req.ID, perr.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		_ = db.Close()
		return errorResponse(req.ID, err.Error())
	}
	d.sessions.Put(session.NewSession(sessionID, db, params, profile))
	logOpInfo(MethodSessionOpen, "session", sessionID, "file", params.ResolvedFilePath(), "family", profile.Family)
	return okResponse(req.ID, map[string]any{
		"sessionId": sessionID,
		"dialect":   profile,
	})
}

func (d *Dispatcher) sessionClose(ctx context.Context, req Request) Response {
	_ = ctx
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if d.io != nil {
		d.io.CancelBySession(params.SessionID)
	}
	if err := d.sessions.Close(params.SessionID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSessionClose, "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

type sessionAttachParams struct {
	SessionID string                 `json:"sessionId"`
	Attach    []session.AttachEntry  `json:"attach"`
	Alias     string                 `json:"alias"`
	FilePath  string                 `json:"filePath"`
	ReadOnly  bool                   `json:"readOnly"`
}

func (d *Dispatcher) sessionAttach(ctx context.Context, req Request) Response {
	var params sessionAttachParams
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
	entries := params.Attach
	if len(entries) == 0 && strings.TrimSpace(params.Alias) != "" {
		entries = []session.AttachEntry{{
			Alias:    params.Alias,
			FilePath: params.FilePath,
			ReadOnly: params.ReadOnly,
		}}
	}
	if len(entries) == 0 {
		return errorResponse(req.ID, "attach required")
	}
	if err := session.ApplyAttach(ctx, sess.DB, entries); err != nil {
		logOpWarn(MethodSessionAttach, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSessionAttach, "session", params.SessionID, "count", len(entries))
	return okResponse(req.ID, map[string]any{"attached": len(entries)})
}

type sessionDetachParams struct {
	SessionID string   `json:"sessionId"`
	Aliases   []string `json:"aliases"`
	Alias     string   `json:"alias"`
}

func (d *Dispatcher) sessionDetach(ctx context.Context, req Request) Response {
	var params sessionDetachParams
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
	aliases := params.Aliases
	if len(aliases) == 0 && strings.TrimSpace(params.Alias) != "" {
		aliases = []string{params.Alias}
	}
	if len(aliases) == 0 {
		return errorResponse(req.ID, "alias required")
	}
	if err := session.ApplyDetach(ctx, sess.DB, aliases); err != nil {
		logOpWarn(MethodSessionDetach, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSessionDetach, "session", params.SessionID, "count", len(aliases))
	return okResponse(req.ID, map[string]any{"detached": len(aliases)})
}

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	applyHostAddressFallback(req.Params, &params)
	db, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionTest, err, "file", params.ResolvedFilePath(), "ok", false)
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	defer db.Close()

	profile, perr := dialect.Probe(ctx, db, dialect.ProbeOptions{
		ReadOnly:    params.Options.ReadOnly,
		JournalMode: params.Options.JournalMode,
	})
	if perr != nil {
		logOpError(MethodSessionTest, perr, "file", params.ResolvedFilePath(), "ok", false)
		return okResponse(req.ID, map[string]any{"ok": false, "message": perr.Error()})
	}
	version := profile.Version
	if version == "" {
		version, _ = session.ProbeVersion(ctx, db)
	}
	logOpInfo(MethodSessionTest, "file", params.ResolvedFilePath(), "ok", true)
	return okResponse(req.ID, map[string]any{
		"ok":      true,
		"message": "connected",
		"version": version,
		"dialect": profile,
	})
}

// resolveSessionDB 从 sessionId 解析会话（查询 / 事务等必须持有会话的路径）。
func (d *Dispatcher) resolveSessionDB(params json.RawMessage) (*session.Session, error) {
	var p sessionIDParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf(errInvalidParamsFmt, err)
	}
	if p.SessionID == "" {
		return nil, fmt.Errorf("%s", errSessionIDRequired)
	}
	return d.sessions.Get(p.SessionID)
}
