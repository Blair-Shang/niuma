package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"niuma/services/sqlserver-service/internal/dialect"
	"niuma/services/sqlserver-service/internal/session"
)

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionOpen, err, "host", params.HostAddress, "port", params.PortOrDefault())
		return errorResponse(req.ID, session.FormatConnectError(err))
	}
	profile, perr := dialect.Probe(ctx, db)
	if perr != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		logOpError(MethodSessionOpen, perr, "host", params.HostAddress, "port", params.PortOrDefault())
		if errors.Is(perr, dialect.ErrNotSQLServer) {
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
	d.sessions.Put(session.NewSession(sessionID, db, params, tunnelStop, profile))
	logOpInfo(MethodSessionOpen, "session", sessionID, "host", params.HostAddress, "port", params.PortOrDefault(), "family", profile.Family)
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
	if d.io != nil {
		d.io.CancelBySession(params.SessionID)
	}
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
		logOpError(MethodSessionTest, err, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", false)
		return okResponse(req.ID, map[string]any{
			"ok":      false,
			"message": session.FormatConnectError(err),
		})
	}
	defer func() {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}()

	profile, perr := dialect.Probe(ctx, db)
	if perr != nil {
		logOpError(MethodSessionTest, perr, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", false)
		msg := perr.Error()
		if errors.Is(perr, dialect.ErrNotSQLServer) {
			msg = perr.Error()
		}
		return okResponse(req.ID, map[string]any{"ok": false, "message": msg})
	}
	version := profile.Version
	if version == "" {
		version, _ = session.ProbeVersion(ctx, db)
	}
	message := "connected"
	if strings.TrimSpace(version) != "" {
		message = "connected · " + strings.TrimSpace(version)
	}
	logOpInfo(MethodSessionTest, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", true, "version", version)
	return okResponse(req.ID, map[string]any{
		"ok":      true,
		"message": message,
		"version": version,
		"dialect": profile,
	})
}

// resolveDBForDatabase 从 sessionId 或一次性建连参数解析 *sql.DB。
func (d *Dispatcher) resolveDBForDatabase(ctx context.Context, raw json.RawMessage, database string) (*sql.DB, *session.Session, func(), error) {
	database = strings.TrimSpace(database)

	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && withSession.SessionID != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, nil, err
		}
		sessionDB := s.Params.Options.DatabaseOrEmpty()
		if database == "" || strings.EqualFold(database, sessionDB) {
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
