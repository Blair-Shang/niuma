package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/vastbase-service/internal/dialect"
	"niuma/services/vastbase-service/internal/session"
)

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	pool, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		logOpError(MethodSessionOpen, err, "host", params.HostAddress, "port", params.PortNumber)
		return errorResponse(req.ID, err.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return errorResponse(req.ID, err.Error())
	}
	profile, perr := dialect.Probe(ctx, pool)
	if perr != nil || profile == nil {
		fallback := dialect.DefaultVastbase()
		profile = &fallback
	}
	d.sessions.Put(&session.Session{
		ID:         sessionID,
		Pool:       pool,
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
	d.debug.StopByOwner(params.SessionID)
	d.io.CancelBySession(params.SessionID)
	d.tools.CancelBySession(params.SessionID)
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
		logOpWarn(MethodSessionTest, err, "host", params.HostAddress, "port", params.PortNumber, "ok", false)
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	defer func() {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}()

	version, verr := session.ProbeVersion(ctx, pool)
	if verr != nil {
		logOpWarn(MethodSessionTest, verr, "host", params.HostAddress, "port", params.PortNumber, "ok", true)
		return okResponse(req.ID, map[string]any{"ok": true, "message": "connected"})
	}
	profile, _ := dialect.Probe(ctx, pool)
	if profile == nil {
		fallback := dialect.DefaultVastbase()
		profile = &fallback
	}
	profile.Version = version
	logOpInfo(MethodSessionTest, "host", params.HostAddress, "port", params.PortNumber, "ok", true)
	return okResponse(req.ID, map[string]any{
		"ok":      true,
		"message": "connected",
		"version": version,
		"dialect": profile,
	})
}

// resolvePool 从 sessionId 或一次性建连参数解析连接池。
// 短连接场景（树展开未带会话）在 release 时关闭池。
func (d *Dispatcher) resolvePool(ctx context.Context, raw json.RawMessage) (*pgxpool.Pool, *session.Session, func(), error) {
	return d.resolvePoolForDatabase(ctx, raw, "")
}

// resolvePoolForDatabase 在需要访问指定库目录时建连到该库。
// PostgreSQL/Vastbase 的 schema/table 目录属于库内 catalog：连错库会列出错误对象。
func (d *Dispatcher) resolvePoolForDatabase(ctx context.Context, raw json.RawMessage, database string) (*pgxpool.Pool, *session.Session, func(), error) {
	database = strings.TrimSpace(database)

	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && withSession.SessionID != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, nil, err
		}
		sessionDB := s.Params.Options.DatabaseOrDefault()
		if database == "" || database == sessionDB {
			return s.Pool, s, func() {}, nil
		}
		// 会话连的是其他库：为树节点目标库开短连接（仍返回 Session，便于挂查询游标）。
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
