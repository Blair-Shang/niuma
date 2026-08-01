package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/kingbase-service/internal/dialect"
	"niuma/services/kingbase-service/internal/session"
)

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	notices := &session.NoticeSink{}
	pool, tunnelStop, err := session.ConnectWithRuntime(ctx, params, session.ConnectRuntime{
		OnNotice: notices.Handler(),
	})
	if err != nil {
		logOpError(MethodSessionOpen, err, "host", params.HostAddress, "port", params.PortOrDefault())
		return errorResponse(req.ID, err.Error())
	}
	profile, perr := dialect.Probe(ctx, pool)
	if perr != nil {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		logOpError(MethodSessionOpen, perr, "host", params.HostAddress, "port", params.PortOrDefault())
		return errorResponse(req.ID, perr.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return errorResponse(req.ID, err.Error())
	}
	// Probe 可能产生 NOTICE，打开会话前清空以免污染首次查询。
	notices.Clear()
	d.sessions.Put(&session.Session{
		ID:         sessionID,
		Pool:       pool,
		Params:     params,
		TunnelStop: tunnelStop,
		Dialect:    profile,
		Notices:    notices,
	})
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
	if d.lspConns != nil {
		d.lspConns.CloseBySession(params.SessionID)
	}
	if err := d.sessions.Close(params.SessionID); err != nil {
		logOpError(MethodSessionClose, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSessionClose, "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	pool, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionTest, err, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", false)
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	defer func() {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}()

	profile, perr := dialect.Probe(ctx, pool)
	if perr != nil {
		logOpError(MethodSessionTest, perr, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", false)
		msg := perr.Error()
		if errors.Is(perr, dialect.ErrNotKingbase) {
			msg = perr.Error()
		}
		return okResponse(req.ID, map[string]any{"ok": false, "message": msg})
	}
	version := profile.Version
	if version == "" {
		version, _ = session.ProbeVersion(ctx, pool)
	}
	logOpInfo(MethodSessionTest, "host", params.HostAddress, "port", params.PortOrDefault(), "ok", true)
	return okResponse(req.ID, map[string]any{
		"ok":      true,
		"message": "connected",
		"version": version,
		"dialect": profile,
	})
}

// resolvePool 从 sessionId 或一次性建连参数解析连接池。
func (d *Dispatcher) resolvePool(ctx context.Context, raw json.RawMessage) (*pgxpool.Pool, *session.Session, func(), error) {
	return d.resolvePoolForDatabase(ctx, raw, "")
}

// resolvePoolForDatabase 在需要访问指定库目录时建连到该库。
func (d *Dispatcher) resolvePoolForDatabase(ctx context.Context, raw json.RawMessage, database string) (*pgxpool.Pool, *session.Session, func(), error) {
	database = strings.TrimSpace(database)

	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && withSession.SessionID != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, nil, err
		}
		sessionDB := s.Params.Options.DatabaseOrDefault()
		if database == "" || strings.EqualFold(database, sessionDB) {
			return s.Pool, s, func() {}, nil
		}
		p := s.Params
		p.Options.Database = database
		pool, tunnelStop, err := session.Connect(ctx, p)
		if err != nil {
			return nil, nil, nil, err
		}
		return pool, s, func() {
			pool.Close()
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
	pool, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		return nil, nil, nil, err
	}
	return pool, nil, func() {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}, nil
}
