package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"niuma/services/mysql-service/internal/dialect"
	"niuma/services/mysql-service/internal/session"
)

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionOpen, err, "host", params.HostAddress, "port", params.PortNumber)
		return errorResponse(req.ID, err.Error())
	}
	profile, perr := dialect.Probe(ctx, db)
	if perr != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		logOpError(MethodSessionOpen, perr, "host", params.HostAddress, "port", params.PortNumber)
		if errors.Is(perr, dialect.ErrMariaDBRejected) {
			return errorEngineMismatch(req.ID, perr)
		}
		return errorResponse(req.ID, perr.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return errorResponse(req.ID, err.Error())
	}
	d.sessions.Put(&session.Session{
		ID:         sessionID,
		DB:         db,
		Params:     params,
		TunnelStop: tunnelStop,
		Dialect:    profile,
	})
	logOpInfo(MethodSessionOpen, "session", sessionID, "host", params.HostAddress, "port", params.PortNumber, "family", profile.Family)
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
	if err := d.sessions.Close(params.SessionID); err != nil {
		logOpError(MethodSessionClose, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	d.io.CancelBySession(params.SessionID)
	d.tools.CancelBySession(params.SessionID)
	if d.lspConns != nil {
		d.lspConns.CloseBySession(params.SessionID)
	}
	logOpInfo(MethodSessionClose, "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionTest, err, "host", params.HostAddress, "port", params.PortNumber, "ok", false)
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	defer func() {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}()

	profile, perr := dialect.Probe(ctx, db)
	if perr != nil {
		logOpError(MethodSessionTest, perr, "host", params.HostAddress, "port", params.PortNumber, "ok", false)
		msg := perr.Error()
		if errors.Is(perr, dialect.ErrMariaDBRejected) {
			msg = perr.Error()
		}
		return okResponse(req.ID, map[string]any{"ok": false, "message": msg})
	}
	version := profile.Version
	if version == "" {
		version, _ = session.ProbeVersion(ctx, db)
	}
	logOpInfo(MethodSessionTest, "host", params.HostAddress, "port", params.PortNumber, "ok", true)
	return okResponse(req.ID, map[string]any{
		"ok":      true,
		"message": "connected",
		"version": version,
		"dialect": profile,
	})
}

// resolveDB 从 sessionId 或一次性建连参数解析 *sql.DB（不切换库）。
func (d *Dispatcher) resolveDB(ctx context.Context, raw json.RawMessage) (*sql.DB, *session.Session, func(), error) {
	return d.resolveDBForDatabase(ctx, raw, "")
}

// resolveDBForDatabase 从 sessionId 或一次性建连参数解析 *sql.DB；
// 在需要访问指定库时建连到该库。
func (d *Dispatcher) resolveDBForDatabase(ctx context.Context, raw json.RawMessage, database string) (*sql.DB, *session.Session, func(), error) {
	database = strings.TrimSpace(database)

	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && withSession.SessionID != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, nil, err
		}
		sessionDB := s.Params.Options.DatabaseOrEmpty()
		if database == "" || database == sessionDB {
			return s.DB, s, func() {}, nil
		}
		p := s.Params
		p.Options.Database = database
		db, tunnelStop, err := session.Connect(ctx, p)
		if err != nil {
			return nil, nil, nil, err
		}
		return db, s, func() {
			_ = db.Close()
			if tunnelStop != nil {
				tunnelStop()
			}
		}, nil
	}

	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, nil, nil, fmt.Errorf(errInvalidParamsFmt, err)
	}
	if database != "" {
		params.Options.Database = database
	}
	db, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		return nil, nil, nil, err
	}
	return db, nil, func() {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}, nil
}

// resolveDBForSessionQuery 解析查询用 *sql.DB。
// 非 Auto-commit 时禁止短连换库，强制走会话池（随后在事务连接上 USE）。
func (d *Dispatcher) resolveDBForSessionQuery(ctx context.Context, raw json.RawMessage, database string) (*sql.DB, *session.Session, func(), error) {
	db, sess, release, err := d.resolveDBForDatabase(ctx, raw, database)
	if err != nil {
		return nil, nil, nil, err
	}
	if sess != nil && !sess.IsAutoCommit() && db != sess.DB {
		release()
		return sess.DB, sess, func() {}, nil
	}
	return db, sess, release, nil
}
